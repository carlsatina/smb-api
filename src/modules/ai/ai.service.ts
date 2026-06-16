import { AiProvider, ItemType } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';
import { decryptSecret } from '../../shared/crypto';
import { generateCompletion, runToolConversation, type AiTool, type ChatMessage } from '../../shared/aiClient';
import { reportsService } from '../reports/reports.service';
import { inventoryService } from '../inventory/inventory.service';

// --- store-timezone date helpers -------------------------------------------

const ymdInTimeZone = (date: Date, timeZone: string): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const map: Record<string, string> = {};
    for (const part of parts) {
        if (part.type !== 'literal') map[part.type] = part.value;
    }
    return `${map.year}-${map.month}-${map.day}`;
};

const shiftYmd = (ymd: string, deltaDays: number): string => {
    const [year, month, day] = ymd.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + deltaDays);
    return date.toISOString().slice(0, 10);
};

const round1 = (value: number) => Math.round(value * 10) / 10;

// --- snapshot ---------------------------------------------------------------

/**
 * Builds a compact, deterministic snapshot of one day's performance plus the
 * trailing-7-day baseline. All numbers are computed by the reports layer (which
 * is timezone- and tenant-scoped); the LLM only narrates this — it never sees
 * raw rows or does arithmetic.
 */
const buildDailySnapshot = async (
    storeId: string,
    store: { name: string; currency: string; timezone: string }
) => {
    const timeZone = store.timezone || 'Asia/Manila';
    const today = ymdInTimeZone(new Date(), timeZone);
    const targetDay = shiftYmd(today, -1); // last complete day
    const baselineFrom = shiftYmd(targetDay, -7);
    const baselineTo = shiftYmd(targetDay, -1);

    const [sales, profit, topProducts, payments, baseline, lowStock] = await Promise.all([
        reportsService.getSalesSummary(storeId, targetDay, targetDay),
        reportsService.getProfitSummary(storeId, targetDay, targetDay),
        reportsService.getTopProducts(storeId, targetDay, targetDay, 5),
        reportsService.getPaymentMethodBreakdown(storeId, targetDay, targetDay),
        reportsService.getSalesByDay(storeId, baselineFrom, baselineTo),
        reportsService.getLowStock(storeId, 10),
    ]);

    const avgDailyNetSales = baseline.days.length
        ? round1(baseline.days.reduce((sum, d) => sum + d.totalSales, 0) / baseline.days.length)
        : 0;
    const deltaVsAvgPct =
        avgDailyNetSales > 0 ? round1(((sales.totals.netSales - avgDailyNetSales) / avgDailyNetSales) * 100) : null;

    return {
        store: { name: store.name, currency: store.currency, timezone: timeZone },
        targetDate: targetDay,
        sales: {
            netSales: sales.totals.netSales,
            orderCount: sales.totals.orderCount,
            avgOrder: sales.totals.avgOrder,
            discounts: sales.totals.discounts,
            voidedSales: sales.totals.voidedSales,
            voidCount: sales.totals.voidCount,
        },
        baseline: {
            days: baseline.days.length,
            avgDailyNetSales,
            deltaVsAvgPct,
        },
        profit: {
            totalRevenue: profit.summary.totalRevenue,
            totalCost: profit.summary.totalCost,
            totalProfit: profit.summary.totalProfit,
            marginPct: profit.summary.marginPct,
            itemsWithCost: profit.summary.itemsWithCost,
            totalItems: profit.summary.totalItems,
        },
        topProducts: topProducts.products.map((p) => ({ name: p.name, qty: p.qtySold, revenue: p.totalSales })),
        paymentMix: payments.methods.map((m) => ({ method: m.method, total: m.total, sharePct: m.sharePct })),
        lowStock: lowStock.items.map((i) => ({
            name: i.name,
            unit: i.unit,
            currentQty: i.currentQty,
            threshold: i.lowStockThreshold,
        })),
    };
};

const SYSTEM_PROMPT = `You are a concise business analyst for a small restaurant/retail POS.
You are given a JSON snapshot of one day's performance for a single store, with a trailing 7-day baseline.
Write a short, plain-language daily summary an owner can read in 20 seconds.

Rules:
- Use ONLY the numbers in the snapshot. Never invent figures. If a value is 0 or missing, say so plainly.
- Format money with the store's currency code (e.g. "PHP 8,450"). Round to whole units.
- Structure: one bold headline line, then 3-5 short bullet points, then at most 2 brief, concrete suggestions.
- Cover: sales vs the baseline average, top sellers, profit margin (note if cost data is incomplete: itemsWithCost vs totalItems), and any low-stock items worth reordering.
- If margin context is thin or there were no sales, keep it honest and short.
- Output GitHub-flavored Markdown. Keep the whole thing under ~180 words. Do not echo the JSON.`;

// --- Ask-your-data chat ----------------------------------------------------

const dateRangeProps = {
    from: { type: 'string', description: 'Start date YYYY-MM-DD in the store timezone. Omit for the last 14 days.' },
    to: { type: 'string', description: 'End date YYYY-MM-DD in the store timezone. Omit for the last 14 days.' },
} as const;

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const int = (value: unknown, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : fallback;
};

// Read-only tools the chat model may call. Each delegates to the (tenant-scoped,
// timezone-correct) reports layer — the model never touches the database.
const buildReportTools = (storeId: string): AiTool[] => [
    {
        name: 'get_sales_summary',
        description: 'Net/gross sales, order count, average order, discounts, and voids for a date range.',
        parameters: { type: 'object', properties: { ...dateRangeProps }, additionalProperties: false },
        execute: (a) => reportsService.getSalesSummary(storeId, str(a.from), str(a.to)),
    },
    {
        name: 'get_sales_by_day',
        description: 'Daily sales totals and order counts across a date range (for trends/comparisons).',
        parameters: { type: 'object', properties: { ...dateRangeProps }, additionalProperties: false },
        execute: (a) => reportsService.getSalesByDay(storeId, str(a.from), str(a.to)),
    },
    {
        name: 'get_top_products',
        description: 'Best-selling products by revenue for a date range, with quantity sold.',
        parameters: {
            type: 'object',
            properties: { ...dateRangeProps, limit: { type: 'integer', description: 'Max products (default 10).' } },
            additionalProperties: false,
        },
        execute: (a) => reportsService.getTopProducts(storeId, str(a.from), str(a.to), int(a.limit, 10)),
    },
    {
        name: 'get_product_margins',
        description: 'Per-product revenue, cost, profit, and margin % for a date range (cost may be unknown for some items).',
        parameters: {
            type: 'object',
            properties: { ...dateRangeProps, limit: { type: 'integer', description: 'Max products (default 10).' } },
            additionalProperties: false,
        },
        execute: (a) => reportsService.getProductMargins(storeId, str(a.from), str(a.to), int(a.limit, 10)),
    },
    {
        name: 'get_profit_summary',
        description: 'Total revenue, cost, profit, and overall margin % for a date range.',
        parameters: { type: 'object', properties: { ...dateRangeProps }, additionalProperties: false },
        execute: (a) => reportsService.getProfitSummary(storeId, str(a.from), str(a.to)),
    },
    {
        name: 'get_payment_methods',
        description: 'Sales totals and share by payment method (cash, card, GCash, etc.) for a date range.',
        parameters: { type: 'object', properties: { ...dateRangeProps }, additionalProperties: false },
        execute: (a) => reportsService.getPaymentMethodBreakdown(storeId, str(a.from), str(a.to)),
    },
    {
        name: 'get_low_stock',
        description: 'Items currently at or below their low-stock threshold (current inventory; no date range).',
        parameters: {
            type: 'object',
            properties: { limit: { type: 'integer', description: 'Max items (default 15).' } },
            additionalProperties: false,
        },
        execute: (a) => reportsService.getLowStock(storeId, int(a.limit, 15)),
    },
];

const chatSystemPrompt = (store: { name: string; currency: string; timezone: string }, today: string) =>
    `You are a data analyst embedded in a small restaurant/retail POS, answering questions about the store "${store.name}".
Today is ${today} in timezone ${store.timezone}. The store currency code is ${store.currency}.

- Answer ONLY from the provided tools — never guess or fabricate numbers. If a tool returns no data, say so plainly.
- Translate relative dates ("yesterday", "last week", "last month", "May") into from/to as YYYY-MM-DD in the store timezone before calling a tool. If the user gives no timeframe, omit dates (tools default to the last 14 days) and state which period you used.
- Call multiple tools when a question needs it; you may call tools several times.
- Format money with the currency code (e.g. "${store.currency} 1,200"). Be concise and concrete — a short sentence plus bullets or a small table when helpful. Output GitHub-flavored Markdown.
- You can only READ data. If asked to change something, briefly explain where in the app to do it instead.`;

// --- Reorder / purchase forecasting ----------------------------------------

const round2 = (value: number) => Math.round(value * 100) / 100;

const REORDER_WINDOW_DAYS = 30; // trailing window used to estimate usage
const REVIEW_DAYS = 7; // how far ahead we want stock to last beyond lead time
const DEFAULT_LEAD_DAYS = 3; // assumed supplier lead time when no PO history exists

// Average days between ordering and receiving, from this store's PO history.
const computeAvgLeadTimeDays = async (storeId: string): Promise<number> => {
    const orders = await prisma.purchaseOrder.findMany({
        where: { storeId, deletedAt: null, receipts: { some: {} } },
        select: {
            createdAt: true,
            receipts: { select: { receivedAt: true }, orderBy: { receivedAt: 'asc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
    });

    const spans: number[] = [];
    for (const order of orders) {
        const receivedAt = order.receipts[0]?.receivedAt;
        if (!receivedAt) continue;
        const days = (receivedAt.getTime() - order.createdAt.getTime()) / 86_400_000;
        if (days >= 0 && days < 90) spans.push(days);
    }
    if (!spans.length) return DEFAULT_LEAD_DAYS;
    return Math.max(1, Math.round(spans.reduce((a, b) => a + b, 0) / spans.length));
};

// Maps each item (by `${itemType}:${id}`) to the supplier on its most recent PO.
const buildSupplierMap = async (storeId: string): Promise<Map<string, string>> => {
    const items = await prisma.purchaseOrderItem.findMany({
        where: { purchaseOrder: { storeId, deletedAt: null } },
        select: {
            itemType: true,
            productId: true,
            ingredientId: true,
            purchaseOrder: { select: { supplierName: true, supplier: { select: { name: true } } } },
        },
        orderBy: { purchaseOrder: { createdAt: 'desc' } },
        take: 500,
    });

    const map = new Map<string, string>();
    for (const item of items) {
        const id = item.itemType === ItemType.PRODUCT ? item.productId : item.ingredientId;
        if (!id) continue;
        const key = `${item.itemType}:${id}`;
        if (map.has(key)) continue;
        const name = item.purchaseOrder.supplierName || item.purchaseOrder.supplier?.name;
        if (name) map.set(key, name);
    }
    return map;
};

// Deterministic reorder plan: usage rate (last 30d), days of cover, and a
// suggested order qty to reach lead-time + review-window of cover. The AI only
// narrates this — every number here is computed in code.
const buildReorderPlan = async (
    storeId: string,
    store: { currency: string; timezone: string }
) => {
    const timeZone = store.timezone || 'Asia/Manila';
    const today = ymdInTimeZone(new Date(), timeZone);
    const from = shiftYmd(today, -REORDER_WINDOW_DAYS);
    const to = shiftYmd(today, -1);

    const [stock, ingredientUsage, productsSold, leadTimeDays, supplierMap] = await Promise.all([
        inventoryService.getStock(storeId),
        reportsService.getIngredientUsage(storeId, from, to, 1000),
        reportsService.getProductsSold(storeId, from, to, 1000),
        computeAvgLeadTimeDays(storeId),
        buildSupplierMap(storeId),
    ]);

    const ingredientUsed = new Map(ingredientUsage.ingredients.map((i) => [i.ingredientId, i.qtyUsed]));
    const productSold = new Map(productsSold.products.map((p) => [p.productId, p.qtySold]));
    const targetDaysOfCover = leadTimeDays + REVIEW_DAYS;

    const suggestions = stock
        .filter((item) => item.active)
        .map((item) => {
            const consumption =
                item.itemType === ItemType.INGREDIENT
                    ? ingredientUsed.get(item.itemId) ?? 0
                    : productSold.get(item.itemId) ?? 0;
            const dailyUsage = consumption / REORDER_WINDOW_DAYS;
            const threshold = item.lowStockThreshold ?? 0;
            const belowThreshold = threshold > 0 && item.currentQty <= threshold;
            const daysOfCover = dailyUsage > 0 ? round1(item.currentQty / dailyUsage) : null;
            const lowCover = daysOfCover !== null && daysOfCover <= targetDaysOfCover;

            if (!belowThreshold && !lowCover) return null;

            const suggestedQty =
                dailyUsage > 0
                    ? Math.max(0, Math.ceil(dailyUsage * targetDaysOfCover - item.currentQty))
                    : Math.max(0, Math.ceil(threshold - item.currentQty));
            if (suggestedQty <= 0) return null;

            return {
                itemType: item.itemType,
                itemId: item.itemId,
                name: item.name,
                unit: item.unit,
                currentQty: round2(item.currentQty),
                dailyUsage: round2(dailyUsage),
                daysOfCover,
                suggestedQty,
                supplier: supplierMap.get(`${item.itemType}:${item.itemId}`) ?? null,
                reason: lowCover ? 'low_days_of_cover' : 'below_threshold',
            };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)
        // Most urgent first (lowest cover; items with no usage but below threshold sort to top).
        .sort((a, b) => (a.daysOfCover ?? -1) - (b.daysOfCover ?? -1));

    return {
        window: { from, to, days: REORDER_WINDOW_DAYS },
        leadTimeDays,
        reviewDays: REVIEW_DAYS,
        targetDaysOfCover,
        currency: store.currency,
        totalFlagged: suggestions.length,
        suggestions: suggestions.slice(0, 40),
    };
};

const reorderSystemPrompt = (store: { currency: string }) =>
    `You are a purchasing assistant for a small restaurant/retail business.
You are given a JSON reorder plan that the app already computed (usage rates, days of cover, suggested quantities, suppliers).

- Use ONLY the items and numbers in the JSON — never invent items, quantities, or suppliers.
- Write a short, prioritized briefing: call out the 3-5 most urgent items first (lowest days of cover) and why, then note anything below its stock threshold with no recent usage.
- Group by supplier when suppliers are present; flag items with no supplier on file as "needs a supplier".
- Format money/quantities plainly and use the currency code "${store.currency}" for any money.
- Keep it under ~160 words, GitHub-flavored Markdown. Do not echo the JSON or restate every row — the full table is shown separately.`;

// Loads the store and its decrypted AI key, enforcing that AI is configured.
const loadStoreAi = async (storeId: string) => {
    const store = await prisma.store.findFirst({
        where: { id: storeId, deletedAt: null },
        select: {
            name: true,
            currency: true,
            timezone: true,
            aiProvider: true,
            aiModel: true,
            aiApiKeyEncrypted: true,
        },
    });
    if (!store) {
        throw new AppError('NOT_FOUND', 'Store not found', 404);
    }
    if (!store.aiProvider) {
        throw new AppError('AI_NOT_CONFIGURED', 'Configure an AI provider in Store Settings first.', 400);
    }
    if (!store.aiApiKeyEncrypted) {
        throw new AppError('AI_KEY_MISSING', 'Save an AI API key in Store Settings first.', 400);
    }
    const apiKey = decryptSecret(store.aiApiKeyEncrypted);
    if (!apiKey) {
        throw new AppError('AI_KEY_UNREADABLE', 'The stored API key could not be decrypted. Re-enter it.', 400);
    }
    return { store, apiKey };
};

export const aiService = {
    generateDailySummary: async (storeId: string) => {
        const { store, apiKey } = await loadStoreAi(storeId);

        const snapshot = await buildDailySnapshot(storeId, store);

        const result = await generateCompletion(
            store.aiProvider as AiProvider,
            apiKey,
            store.aiModel,
            SYSTEM_PROMPT,
            JSON.stringify(snapshot)
        );

        if (!result.ok) {
            throw new AppError('AI_REQUEST_FAILED', result.message, 502);
        }

        return { summary: result.text, model: result.model, data: snapshot };
    },
    chat: async (storeId: string, messages: ChatMessage[]) => {
        const { store, apiKey } = await loadStoreAi(storeId);
        const today = ymdInTimeZone(new Date(), store.timezone || 'Asia/Manila');

        const result = await runToolConversation(
            store.aiProvider as AiProvider,
            apiKey,
            store.aiModel,
            chatSystemPrompt(store, today),
            messages,
            buildReportTools(storeId)
        );

        if (!result.ok) {
            throw new AppError('AI_REQUEST_FAILED', result.message, 502);
        }

        return { reply: result.text, model: result.model };
    },
    generateReorderPlan: async (storeId: string) => {
        const { store, apiKey } = await loadStoreAi(storeId);
        const plan = await buildReorderPlan(storeId, store);

        // The plan stands on its own; the AI narrative is a best-effort layer.
        // If the provider call fails at runtime, still return the suggestions.
        const result = await generateCompletion(
            store.aiProvider as AiProvider,
            apiKey,
            store.aiModel,
            reorderSystemPrompt(store),
            JSON.stringify(plan)
        );

        return {
            plan,
            narrative: result.ok ? result.text : null,
            narrativeError: result.ok ? null : result.message,
            model: result.ok ? result.model : null,
        };
    },
};
