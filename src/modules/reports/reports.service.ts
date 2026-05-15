import { ItemType, MovementType, PaymentMethod, Prisma, ProductType, SaleStatus } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';
import { inventoryService } from '../inventory/inventory.service';

type SalesByDayRow = {
    day: string;
    total: Prisma.Decimal | number | string | null;
    orders: bigint | number | string;
};

type SalesByHourRow = {
    hour: number | string;
    total: Prisma.Decimal | number | string | null;
    orders: bigint | number | string;
};

type SalesSummaryRow = {
    gross: Prisma.Decimal | number | string | null;
    discounts: Prisma.Decimal | number | string | null;
    tax: Prisma.Decimal | number | string | null;
    net: Prisma.Decimal | number | string | null;
    orders: bigint | number | string;
};

type VoidSummaryRow = {
    voidTotal: Prisma.Decimal | number | string | null;
    voidCount: bigint | number | string;
};

type TopProductRow = {
    productId: string;
    qty: Prisma.Decimal | number | string | null;
    total: Prisma.Decimal | number | string | null;
};

type IngredientUsageRow = {
    itemId: string;
    qtyDelta: Prisma.Decimal | number | string | null;
};

type ProductMarginRow = {
    productId: string;
    qty: Prisma.Decimal | number | string | null;
    total: Prisma.Decimal | number | string | null;
};

type PurchaseSpendRow = {
    supplierId: string | null;
    supplier: string | null;
    total: Prisma.Decimal | number | string | null;
    receipts: bigint | number | string;
};

type PurchaseSpendTotalRow = {
    total: Prisma.Decimal | number | string | null;
    receipts: bigint | number | string;
};

type PaymentMethodRow = {
    method: PaymentMethod;
    total: Prisma.Decimal | number | string | null;
    orders: bigint | number | string;
};

type EmployeeSalesRow = {
    cashierId: string;
    fullName: string | null;
    email: string;
    role: string | null;
    method: PaymentMethod;
    total: Prisma.Decimal | number | string | null;
    orders: bigint | number | string;
};

const normalizeNumber = (value: Prisma.Decimal | number | string | bigint | null | undefined) => {
    if (value === null || value === undefined) return 0;
    return Number(value);
};

const roundMoney = (value: number) => Number(value.toFixed(2));
const roundQty = (value: number) => Number(value.toFixed(4));

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const getDateFormatter = (timeZone: string) => {
    const existing = formatterCache.get(timeZone);
    if (existing) return existing;
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
    return formatter;
};

const formatDateInTimeZone = (value: Date, timeZone: string) => {
    const parts = getDateFormatter(timeZone).formatToParts(value);
    const lookup: Record<string, string> = {};
    parts.forEach((part) => {
        if (part.type !== 'literal') {
            lookup[part.type] = part.value;
        }
    });
    return `${lookup.year}-${lookup.month}-${lookup.day}`;
};

const shiftDate = (value: string, deltaDays: number) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + deltaDays);
    return date.toISOString().slice(0, 10);
};

const buildDateRange = (from: string | undefined, to: string | undefined, timeZone: string) => {
    const endDate = to ?? formatDateInTimeZone(new Date(), timeZone);
    const startDate = from ?? shiftDate(endDate, -13);
    return { startDate, endDate };
};

const buildDateKeys = (startDate: string, endDate: string) => {
    const keys: string[] = [];
    let cursor = startDate;
    while (cursor <= endDate) {
        keys.push(cursor);
        cursor = shiftDate(cursor, 1);
    }
    return keys;
};

const ensureStore = async (storeId: string) => {
    const store = await prisma.store.findFirst({
        where: { id: storeId, deletedAt: null },
        select: { id: true, timezone: true },
    });

    if (!store) {
        throw new AppError('NOT_FOUND', 'Store not found', 404);
    }

    return store;
};

export const reportsService = {
    getSalesSummary: async (storeId: string, from?: string, to?: string) => {
        const store = await ensureStore(storeId);
        const timeZone = store.timezone || 'UTC';
        const { startDate, endDate } = buildDateRange(from, to, timeZone);

        const summaryRows = await prisma.$queryRaw<SalesSummaryRow[]>`
            SELECT SUM("subtotal") AS gross,
                   SUM("discount") AS discounts,
                   SUM("tax") AS tax,
                   SUM("total") AS net,
                   COUNT(*) AS orders
            FROM "Sale"
            WHERE "storeId" = ${storeId}
              AND "status" = ${SaleStatus.FINALIZED}
              AND "deletedAt" IS NULL
              AND timezone(${timeZone}, (COALESCE("finalizedAt", "createdAt") AT TIME ZONE 'UTC')) >= ${startDate}::date
              AND timezone(${timeZone}, (COALESCE("finalizedAt", "createdAt") AT TIME ZONE 'UTC')) < (${endDate}::date + interval '1 day')
        `;

        const voidRows = await prisma.$queryRaw<VoidSummaryRow[]>`
            SELECT SUM("total") AS "voidTotal",
                   COUNT(*) AS "voidCount"
            FROM "Sale"
            WHERE "storeId" = ${storeId}
              AND "status" = ${SaleStatus.VOIDED}
              AND "deletedAt" IS NULL
              AND "voidedAt" IS NOT NULL
              AND timezone(${timeZone}, ("voidedAt" AT TIME ZONE 'UTC')) >= ${startDate}::date
              AND timezone(${timeZone}, ("voidedAt" AT TIME ZONE 'UTC')) < (${endDate}::date + interval '1 day')
        `;

        const summary = summaryRows[0];
        const voided = voidRows[0];
        const netSales = roundMoney(normalizeNumber(summary?.net));
        const orderCount = normalizeNumber(summary?.orders);
        const avgOrder = orderCount ? roundMoney(netSales / orderCount) : 0;

        return {
            range: {
                from: startDate,
                to: endDate,
            },
            totals: {
                grossSales: roundMoney(normalizeNumber(summary?.gross)),
                discounts: roundMoney(normalizeNumber(summary?.discounts)),
                tax: roundMoney(normalizeNumber(summary?.tax)),
                netSales,
                orderCount,
                avgOrder,
                voidedSales: roundMoney(normalizeNumber(voided?.voidTotal)),
                voidCount: normalizeNumber(voided?.voidCount),
            },
        };
    },
    getSalesByDay: async (storeId: string, from?: string, to?: string) => {
        const store = await ensureStore(storeId);
        const timeZone = store.timezone || 'UTC';
        const { startDate, endDate } = buildDateRange(from, to, timeZone);

        const rows = await prisma.$queryRaw<SalesByDayRow[]>`
            SELECT to_char(
                       date_trunc('day', timezone(${timeZone}, (COALESCE("finalizedAt", "createdAt") AT TIME ZONE 'UTC'))),
                       'YYYY-MM-DD'
                   ) AS day,
                   SUM("total") AS total,
                   COUNT(*) AS orders
            FROM "Sale"
            WHERE "storeId" = ${storeId}
              AND "status" = ${SaleStatus.FINALIZED}
              AND "deletedAt" IS NULL
              AND timezone(${timeZone}, (COALESCE("finalizedAt", "createdAt") AT TIME ZONE 'UTC')) >= ${startDate}::date
              AND timezone(${timeZone}, (COALESCE("finalizedAt", "createdAt") AT TIME ZONE 'UTC')) < (${endDate}::date + interval '1 day')
            GROUP BY day
            ORDER BY day ASC
        `;

        const rowMap = new Map(rows.map((row) => [row.day, row]));
        const keys = buildDateKeys(startDate, endDate);

        const days = keys.map((key) => {
            const row = rowMap.get(key);
            return {
                date: key,
                totalSales: row ? roundMoney(normalizeNumber(row.total)) : 0,
                orderCount: row ? normalizeNumber(row.orders) : 0,
            };
        });

        const totalSales = roundMoney(days.reduce((sum, day) => sum + day.totalSales, 0));
        const orderCount = days.reduce((sum, day) => sum + day.orderCount, 0);
        const avgOrder = orderCount ? roundMoney(totalSales / orderCount) : 0;

        return {
            range: {
                from: startDate,
                to: endDate,
            },
            totals: {
                totalSales,
                orderCount,
                avgOrder,
            },
            days,
        };
    },
    getSalesByHour: async (storeId: string, from?: string, to?: string) => {
        const store = await ensureStore(storeId);
        const timeZone = store.timezone || 'UTC';
        const { startDate, endDate } = buildDateRange(from, to, timeZone);

        const rows = await prisma.$queryRaw<SalesByHourRow[]>`
            SELECT EXTRACT(HOUR FROM timezone(${timeZone}, (COALESCE("finalizedAt", "createdAt") AT TIME ZONE 'UTC'))) AS hour,
                   SUM("total") AS total,
                   COUNT(*) AS orders
            FROM "Sale"
            WHERE "storeId" = ${storeId}
              AND "status" = ${SaleStatus.FINALIZED}
              AND "deletedAt" IS NULL
              AND timezone(${timeZone}, (COALESCE("finalizedAt", "createdAt") AT TIME ZONE 'UTC')) >= ${startDate}::date
              AND timezone(${timeZone}, (COALESCE("finalizedAt", "createdAt") AT TIME ZONE 'UTC')) < (${endDate}::date + interval '1 day')
            GROUP BY hour
            ORDER BY hour ASC
        `;

        const rowMap = new Map<number, SalesByHourRow>(
            rows.map((row) => [Number(row.hour), row])
        );
        const hours = Array.from({ length: 24 }, (_, hour) => {
            const row = rowMap.get(hour);
            return {
                hour,
                totalSales: row ? roundMoney(normalizeNumber(row.total)) : 0,
                orderCount: row ? normalizeNumber(row.orders) : 0,
            };
        });

        return {
            range: {
                from: startDate,
                to: endDate,
            },
            hours,
        };
    },
    getTopProducts: async (storeId: string, from: string | undefined, to: string | undefined, limit: number) => {
        const store = await ensureStore(storeId);
        const timeZone = store.timezone || 'UTC';
        const { startDate, endDate } = buildDateRange(from, to, timeZone);

        const rows = await prisma.$queryRaw<TopProductRow[]>`
            SELECT si."productId" AS "productId",
                   SUM(si."qty") AS qty,
                   SUM(si."total") AS total
            FROM "SaleItem" si
            JOIN "Sale" s ON s."id" = si."saleId"
            WHERE s."storeId" = ${storeId}
              AND s."status" = ${SaleStatus.FINALIZED}
              AND s."deletedAt" IS NULL
              AND timezone(${timeZone}, (COALESCE(s."finalizedAt", s."createdAt") AT TIME ZONE 'UTC')) >= ${startDate}::date
              AND timezone(${timeZone}, (COALESCE(s."finalizedAt", s."createdAt") AT TIME ZONE 'UTC')) < (${endDate}::date + interval '1 day')
            GROUP BY si."productId"
            ORDER BY total DESC
            LIMIT ${limit}
        `;

        const productIds = rows.map((row) => row.productId);
        const productRows = productIds.length
            ? await prisma.product.findMany({
                  where: { id: { in: productIds }, storeId, deletedAt: null },
                  select: { id: true, name: true, sku: true, unit: true },
              })
            : [];

        const productMap = new Map(productRows.map((product) => [product.id, product]));

        const products = rows.map((row) => {
            const product = productMap.get(row.productId);
            return {
                productId: row.productId,
                name: product?.name ?? 'Unknown',
                sku: product?.sku ?? null,
                unit: product?.unit ?? null,
                qtySold: normalizeNumber(row.qty),
                totalSales: roundMoney(normalizeNumber(row.total)),
            };
        });
        return {
            range: {
                from: startDate,
                to: endDate,
            },
            products,
        };
    },
    getProductMargins: async (storeId: string, from: string | undefined, to: string | undefined, limit: number) => {
        const store = await ensureStore(storeId);
        const timeZone = store.timezone || 'UTC';
        const { startDate, endDate } = buildDateRange(from, to, timeZone);

        const rows = await prisma.$queryRaw<ProductMarginRow[]>`
            SELECT si."productId" AS "productId",
                   SUM(si."qty") AS qty,
                   SUM(si."total") AS total
            FROM "SaleItem" si
            JOIN "Sale" s ON s."id" = si."saleId"
            WHERE s."storeId" = ${storeId}
              AND s."status" = ${SaleStatus.FINALIZED}
              AND s."deletedAt" IS NULL
              AND timezone(${timeZone}, (COALESCE(s."finalizedAt", s."createdAt") AT TIME ZONE 'UTC')) >= ${startDate}::date
              AND timezone(${timeZone}, (COALESCE(s."finalizedAt", s."createdAt") AT TIME ZONE 'UTC')) < (${endDate}::date + interval '1 day')
            GROUP BY si."productId"
            ORDER BY total DESC
            LIMIT ${limit}
        `;

        const productIds = rows.map((row) => row.productId);
        const products = productIds.length
            ? await prisma.product.findMany({
                  where: { id: { in: productIds }, storeId, deletedAt: null },
                  select: { id: true, name: true, sku: true, unit: true, type: true, cost: true },
              })
            : [];

        const recipeLines = productIds.length
            ? await prisma.recipeLine.findMany({
                  where: {
                      recipe: {
                          storeId,
                          deletedAt: null,
                          productId: { in: productIds },
                      },
                      ingredient: {
                          deletedAt: null,
                      },
                  },
                  select: {
                      qtyPerProductUnit: true,
                      ingredient: { select: { costPerUnit: true } },
                      recipe: { select: { productId: true } },
                  },
              })
            : [];

        const recipeCostMap = new Map<string, number>();
        recipeLines.forEach((line) => {
            const cost = normalizeNumber(line.ingredient.costPerUnit) * normalizeNumber(line.qtyPerProductUnit);
            const current = recipeCostMap.get(line.recipe.productId) ?? 0;
            recipeCostMap.set(line.recipe.productId, current + cost);
        });

        const productMap = new Map(products.map((product) => [product.id, product]));
        const items = rows.map((row) => {
            const product = productMap.get(row.productId);
            const qtySold = normalizeNumber(row.qty);
            const revenue = roundMoney(normalizeNumber(row.total));

            let costPerUnit: number | null = null;
            if (product) {
                if (product.type === ProductType.RECIPE) {
                    costPerUnit = recipeCostMap.has(product.id) ? recipeCostMap.get(product.id) ?? 0 : null;
                } else {
                    costPerUnit = product.cost !== null ? normalizeNumber(product.cost) : null;
                }
            }

            const costKnown = costPerUnit !== null;
            const totalCost = costKnown ? roundMoney(qtySold * (costPerUnit ?? 0)) : null;
            const profit = costKnown ? roundMoney(revenue - (totalCost ?? 0)) : null;
            const marginPct =
                costKnown && revenue > 0 && profit !== null
                    ? roundMoney((profit / revenue) * 100)
                    : null;

            return {
                productId: row.productId,
                name: product?.name ?? 'Unknown',
                sku: product?.sku ?? null,
                unit: product?.unit ?? null,
                qtySold,
                revenue,
                cost: totalCost,
                profit,
                marginPct,
                costKnown,
            };
        });

        const costedItems = items.filter((item) => item.costKnown).length;

        return {
            range: {
                from: startDate,
                to: endDate,
            },
            summary: {
                costedItems,
                totalItems: items.length,
            },
            items,
        };
    },
    getLowStock: async (storeId: string, limit: number) => {
        const stock = await inventoryService.getStock(storeId);
        const lowStock = stock
            .filter((item) => item.active && item.lowStockThreshold > 0 && item.currentQty <= item.lowStockThreshold)
            .map((item) => ({
                itemType: item.itemType,
                itemId: item.itemId,
                name: item.name,
                unit: item.unit,
                currentQty: item.currentQty,
                lowStockThreshold: item.lowStockThreshold,
                shortfall: roundQty(item.lowStockThreshold - item.currentQty),
            }))
            .sort((a, b) => b.shortfall - a.shortfall)
            .slice(0, limit);

        return {
            items: lowStock,
        };
    },
    getIngredientUsage: async (storeId: string, from: string | undefined, to: string | undefined, limit: number) => {
        const store = await ensureStore(storeId);
        const timeZone = store.timezone || 'UTC';
        const { startDate, endDate } = buildDateRange(from, to, timeZone);

        const rows = await prisma.$queryRaw<IngredientUsageRow[]>`
            SELECT im."itemId" AS "itemId",
                   SUM(im."qtyDelta") AS "qtyDelta"
            FROM "InventoryMovement" im
            WHERE im."storeId" = ${storeId}
              AND im."itemType" = ${ItemType.INGREDIENT}
              AND im."type" = ${MovementType.SALE}
              AND timezone(${timeZone}, (im."createdAt" AT TIME ZONE 'UTC')) >= ${startDate}::date
              AND timezone(${timeZone}, (im."createdAt" AT TIME ZONE 'UTC')) < (${endDate}::date + interval '1 day')
            GROUP BY im."itemId"
            ORDER BY "qtyDelta" ASC
            LIMIT ${limit}
        `;

        const ingredientIds = rows.map((row) => row.itemId);
        const ingredients = ingredientIds.length
            ? await prisma.ingredient.findMany({
                  where: { id: { in: ingredientIds }, storeId, deletedAt: null },
                  select: { id: true, name: true, unit: true },
              })
            : [];

        const ingredientMap = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));

        return {
            range: {
                from: startDate,
                to: endDate,
            },
            ingredients: rows.map((row) => {
                const ingredient = ingredientMap.get(row.itemId);
                const qtyUsed = Math.abs(normalizeNumber(row.qtyDelta));
                return {
                    ingredientId: row.itemId,
                    name: ingredient?.name ?? 'Unknown',
                    unit: ingredient?.unit ?? '',
                    qtyUsed: roundQty(qtyUsed),
                };
            }),
        };
    },
    getPurchaseSpend: async (storeId: string, from: string | undefined, to: string | undefined, limit: number) => {
        const store = await ensureStore(storeId);
        const timeZone = store.timezone || 'UTC';
        const { startDate, endDate } = buildDateRange(from, to, timeZone);

        const totalsRows = await prisma.$queryRaw<PurchaseSpendTotalRow[]>`
            SELECT SUM(pr."totalCost") AS total,
                   COUNT(*) AS receipts
            FROM "PurchaseReceipt" pr
            WHERE pr."storeId" = ${storeId}
              AND timezone(${timeZone}, (pr."receivedAt" AT TIME ZONE 'UTC')) >= ${startDate}::date
              AND timezone(${timeZone}, (pr."receivedAt" AT TIME ZONE 'UTC')) < (${endDate}::date + interval '1 day')
        `;

        const totals = totalsRows[0];

        const rows = await prisma.$queryRaw<PurchaseSpendRow[]>`
            SELECT s."id" AS "supplierId",
                   COALESCE(s."name", po."supplierName", 'Unassigned') AS supplier,
                   SUM(pr."totalCost") AS total,
                   COUNT(*) AS receipts
            FROM "PurchaseReceipt" pr
            LEFT JOIN "PurchaseOrder" po ON po."id" = pr."purchaseOrderId"
            LEFT JOIN "Supplier" s ON s."id" = po."supplierId"
            WHERE pr."storeId" = ${storeId}
              AND timezone(${timeZone}, (pr."receivedAt" AT TIME ZONE 'UTC')) >= ${startDate}::date
              AND timezone(${timeZone}, (pr."receivedAt" AT TIME ZONE 'UTC')) < (${endDate}::date + interval '1 day')
            GROUP BY s."id", supplier
            ORDER BY total DESC
            LIMIT ${limit}
        `;

        const totalSpend = roundMoney(normalizeNumber(totals?.total));
        const totalReceipts = totals ? normalizeNumber(totals.receipts) : 0;
        const avgReceipt = totalReceipts ? roundMoney(totalSpend / totalReceipts) : 0;

        return {
            range: {
                from: startDate,
                to: endDate,
            },
            summary: {
                totalSpend,
                totalReceipts,
                avgReceipt,
            },
            suppliers: rows.map((row) => ({
                supplierId: row.supplierId ?? null,
                supplierName: row.supplier ?? 'Unassigned',
                totalSpend: roundMoney(normalizeNumber(row.total)),
                receiptCount: normalizeNumber(row.receipts),
            })),
        };
    },
    getPaymentMethodBreakdown: async (storeId: string, from?: string, to?: string) => {
        const store = await ensureStore(storeId);
        const timeZone = store.timezone || 'UTC';
        const { startDate, endDate } = buildDateRange(from, to, timeZone);

        const rows = await prisma.$queryRaw<PaymentMethodRow[]>`
            SELECT "paymentMethod" AS method,
                   SUM("total") AS total,
                   COUNT(*) AS orders
            FROM "Sale"
            WHERE "storeId" = ${storeId}
              AND "status" = ${SaleStatus.FINALIZED}
              AND "deletedAt" IS NULL
              AND timezone(${timeZone}, (COALESCE("finalizedAt", "createdAt") AT TIME ZONE 'UTC')) >= ${startDate}::date
              AND timezone(${timeZone}, (COALESCE("finalizedAt", "createdAt") AT TIME ZONE 'UTC')) < (${endDate}::date + interval '1 day')
            GROUP BY "paymentMethod"
            ORDER BY total DESC
        `;

        const grandTotal = rows.reduce((sum, r) => sum + normalizeNumber(r.total), 0);

        return {
            range: { from: startDate, to: endDate },
            grandTotal: roundMoney(grandTotal),
            methods: rows.map((row) => {
                const amount = roundMoney(normalizeNumber(row.total));
                return {
                    method: row.method,
                    total: amount,
                    orderCount: normalizeNumber(row.orders),
                    sharePct: grandTotal > 0 ? Math.round((amount / grandTotal) * 1000) / 10 : 0,
                };
            }),
        };
    },
    getEmployeeSales: async (storeId: string, from?: string, to?: string) => {
        const store = await ensureStore(storeId);
        const timeZone = store.timezone || 'UTC';
        const { startDate, endDate } = buildDateRange(from, to, timeZone);

        const rows = await prisma.$queryRaw<EmployeeSalesRow[]>`
            SELECT
                s."cashierId",
                u."fullName",
                u."email",
                sm."role",
                s."paymentMethod" AS method,
                SUM(s."total")    AS total,
                COUNT(*)          AS orders
            FROM "Sale" s
            JOIN "User" u ON u."id" = s."cashierId"
            LEFT JOIN "StoreMember" sm
                ON sm."storeId" = s."storeId" AND sm."userId" = s."cashierId" AND sm."deletedAt" IS NULL
            WHERE s."storeId" = ${storeId}
              AND s."status"  = ${SaleStatus.FINALIZED}
              AND s."deletedAt" IS NULL
              AND timezone(${timeZone}, (COALESCE(s."finalizedAt", s."createdAt") AT TIME ZONE 'UTC')) >= ${startDate}::date
              AND timezone(${timeZone}, (COALESCE(s."finalizedAt", s."createdAt") AT TIME ZONE 'UTC')) < (${endDate}::date + interval '1 day')
            GROUP BY s."cashierId", u."fullName", u."email", sm."role", s."paymentMethod"
            ORDER BY s."cashierId", s."paymentMethod"
        `;

        const employeeMap = new Map<string, {
            cashierId: string;
            name: string;
            email: string;
            role: string | null;
            totalSales: number;
            orderCount: number;
            methods: { method: string; total: number; orderCount: number }[];
        }>();

        for (const row of rows) {
            const amount = roundMoney(normalizeNumber(row.total));
            const orders = normalizeNumber(row.orders);
            if (!employeeMap.has(row.cashierId)) {
                employeeMap.set(row.cashierId, {
                    cashierId: row.cashierId,
                    name: row.fullName ?? row.email,
                    email: row.email,
                    role: row.role,
                    totalSales: 0,
                    orderCount: 0,
                    methods: [],
                });
            }
            const emp = employeeMap.get(row.cashierId)!;
            emp.totalSales = roundMoney(emp.totalSales + amount);
            emp.orderCount += orders;
            emp.methods.push({ method: row.method, total: amount, orderCount: orders });
        }

        const employees = Array.from(employeeMap.values()).sort(
            (a, b) => b.totalSales - a.totalSales
        );

        return {
            range: { from: startDate, to: endDate },
            employees,
        };
    },
};
