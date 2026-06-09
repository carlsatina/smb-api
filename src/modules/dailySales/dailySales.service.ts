import { Prisma, SaleStatus } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';

const toNum = (v: Prisma.Decimal | null | undefined) => Number(v ?? 0);

const computeCashAmount = (entry: {
    denom1000: number; denom500: number; denom200: number;
    denom100: number; denom50: number; denom20: number;
    coins: Prisma.Decimal;
}) =>
    entry.denom1000 * 1000 +
    entry.denom500 * 500 +
    entry.denom200 * 200 +
    entry.denom100 * 100 +
    entry.denom50 * 50 +
    entry.denom20 * 20 +
    toNum(entry.coins);

// Format a JS Date as YYYY-MM-DD in the given IANA timezone
const formatDateInTimezone = (date: Date, timeZone: string): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const lookup: Record<string, string> = {};
    parts.forEach((p) => { if (p.type !== 'literal') lookup[p.type] = p.value; });
    return `${lookup.year}-${lookup.month}-${lookup.day}`;
};

// Get today's date string (YYYY-MM-DD) in the store's timezone
const todayInTimezone = (timeZone: string): string =>
    formatDateInTimezone(new Date(), timeZone);

type SalesAggregate = { pos: number; seniorDiscount: number };

const getSalesAggregateForDate = async (
    storeId: string,
    dateStr: string,    // YYYY-MM-DD in the store's timezone
    timeZone: string,
): Promise<SalesAggregate> => {
    type Row = { pos: Prisma.Decimal | null; senior: Prisma.Decimal | null };
    const rows = await prisma.$queryRaw<Row[]>`
        SELECT
            SUM("total")    AS pos,
            SUM("discount") AS senior
        FROM "Sale"
        WHERE "storeId"   = ${storeId}
          AND "status"    = ${SaleStatus.FINALIZED}::"SaleStatus"
          AND "deletedAt" IS NULL
          AND "finalizedAt" IS NOT NULL
          AND timezone(${timeZone}, "finalizedAt" AT TIME ZONE 'UTC')::date = ${dateStr}::date
    `;
    return {
        pos: toNum(rows[0]?.pos),
        seniorDiscount: toNum(rows[0]?.senior),
    };
};

const getActiveGoal = async (storeId: string, asOfDate: Date): Promise<number> => {
    // Prefer the most recent goal on or before asOfDate; fall back to the earliest
    // goal ever set so past months still reflect the configured goal.
    const goal =
        (await prisma.dailySalesGoal.findFirst({
            where: { storeId, effectiveDate: { lte: asOfDate } },
            orderBy: { effectiveDate: 'desc' },
            select: { goal: true },
        })) ??
        (await prisma.dailySalesGoal.findFirst({
            where: { storeId },
            orderBy: { effectiveDate: 'asc' },
            select: { goal: true },
        }));
    return toNum(goal?.goal);
};

export const dailySalesService = {
    listMonth: async (storeId: string, year: number, month: number) => {
        const store = await prisma.store.findFirst({
            where: { id: storeId, deletedAt: null },
            select: { timezone: true },
        });
        const timeZone = store?.timezone || 'UTC';

        const monthStart = new Date(Date.UTC(year, month - 1, 1));
        const monthEnd = new Date(Date.UTC(year, month, 0)); // last day of month

        const entries = await prisma.dailySalesEntry.findMany({
            where: {
                storeId,
                deletedAt: null,
                date: { gte: monthStart, lte: monthEnd },
            },
            include: {
                cashierEntries: {
                    include: { user: { select: { id: true, fullName: true, email: true } } },
                },
            },
            orderBy: { date: 'desc' },
        });

        const goal = await getActiveGoal(storeId, monthEnd);

        // Compute POS totals and senior discounts for all entry dates in parallel
        // Each entry.date is a Postgres DATE — format it in the store timezone for the SQL query
        const aggregates = await Promise.all(
            entries.map((e) => getSalesAggregateForDate(storeId, formatDateInTimezone(e.date, timeZone), timeZone))
        );

        let cumulativeSalesNeeded = 0;

        // Process in chronological order for cumulative Sales Needed
        const chronological = [...entries].reverse();
        const chronoAgg = [...aggregates].reverse();

        const rowMap = new Map<string, ReturnType<typeof buildRow>>();
        chronological.forEach((entry, idx) => {
            const { pos, seniorDiscount } = chronoAgg[idx];
            const row = buildRow(entry, pos, seniorDiscount, goal, cumulativeSalesNeeded);
            cumulativeSalesNeeded = row.salesNeeded;
            rowMap.set(entry.id, row);
        });

        // Return in desc order (matching DB query order)
        return {
            rows: entries.map((e) => rowMap.get(e.id)!),
            goal,
        };
    },

    getEntry: async (storeId: string, entryId: string) => {
        const entry = await prisma.dailySalesEntry.findFirst({
            where: { id: entryId, storeId, deletedAt: null },
            include: {
                cashierEntries: {
                    include: { user: { select: { id: true, fullName: true, email: true } } },
                },
            },
        });
        if (!entry) throw new AppError('NOT_FOUND', 'Entry not found', 404);
        return entry;
    },

    getPosForDate: async (storeId: string, dateStr: string) => {
        const store = await prisma.store.findFirst({
            where: { id: storeId, deletedAt: null },
            select: { timezone: true },
        });
        const timeZone = store?.timezone || 'UTC';
        return getSalesAggregateForDate(storeId, dateStr, timeZone);
    },

    createEntry: async (
        storeId: string,
        createdById: string,
        data: { date: string; expense: number; actualCoh?: number | null }
    ) => {
        const [y, m, d] = data.date.split('-').map(Number);
        const date = new Date(Date.UTC(y, m - 1, d));

        const existing = await prisma.dailySalesEntry.findFirst({
            where: { storeId, date },
        });

        if (existing && existing.deletedAt === null) {
            throw new AppError('CONFLICT', 'An entry already exists for this date', 409);
        }

        if (existing) {
            // Restore the soft-deleted record instead of creating a new one
            return prisma.dailySalesEntry.update({
                where: { id: existing.id },
                data: {
                    deletedAt: null,
                    expense: new Prisma.Decimal(data.expense),
                    actualCoh: data.actualCoh != null ? new Prisma.Decimal(data.actualCoh) : null,
                    createdById,
                },
                include: { cashierEntries: { include: { user: { select: { id: true, fullName: true, email: true } } } } },
            });
        }

        return prisma.dailySalesEntry.create({
            data: {
                storeId,
                date,
                expense: new Prisma.Decimal(data.expense),
                actualCoh: data.actualCoh != null ? new Prisma.Decimal(data.actualCoh) : null,
                createdById,
            },
            include: { cashierEntries: { include: { user: { select: { id: true, fullName: true, email: true } } } } },
        });
    },

    updateEntry: async (
        storeId: string,
        entryId: string,
        data: { expense?: number; actualCoh?: number | null }
    ) => {
        const entry = await prisma.dailySalesEntry.findFirst({
            where: { id: entryId, storeId, deletedAt: null },
        });
        if (!entry) throw new AppError('NOT_FOUND', 'Entry not found', 404);

        return prisma.dailySalesEntry.update({
            where: { id: entryId },
            data: {
                ...(data.expense !== undefined && { expense: new Prisma.Decimal(data.expense) }),
                ...(data.actualCoh !== undefined && {
                    actualCoh: data.actualCoh != null ? new Prisma.Decimal(data.actualCoh) : null,
                }),
            },
            include: { cashierEntries: { include: { user: { select: { id: true, fullName: true, email: true } } } } },
        });
    },

    deleteEntry: async (storeId: string, entryId: string) => {
        const entry = await prisma.dailySalesEntry.findFirst({
            where: { id: entryId, storeId, deletedAt: null },
        });
        if (!entry) throw new AppError('NOT_FOUND', 'Entry not found', 404);

        await prisma.dailySalesEntry.update({
            where: { id: entryId },
            data: { deletedAt: new Date() },
        });
    },

    upsertCashierEntry: async (
        storeId: string,
        entryId: string,
        userId: string,
        data: {
            gcashAmount: number;
            denom1000: number; denom500: number; denom200: number;
            denom100: number; denom50: number; denom20: number;
            coins: number;
        }
    ) => {
        const entry = await prisma.dailySalesEntry.findFirst({
            where: { id: entryId, storeId, deletedAt: null },
        });
        if (!entry) throw new AppError('NOT_FOUND', 'Entry not found', 404);

        const cashAmount = computeCashAmount({ ...data, coins: new Prisma.Decimal(data.coins) });
        const shared = {
            cashAmount: new Prisma.Decimal(cashAmount),
            gcashAmount: new Prisma.Decimal(data.gcashAmount),
            denom1000: data.denom1000,
            denom500: data.denom500,
            denom200: data.denom200,
            denom100: data.denom100,
            denom50: data.denom50,
            denom20: data.denom20,
            coins: new Prisma.Decimal(data.coins),
        };

        return prisma.dailySalesCashierEntry.upsert({
            where: { dailySalesEntryId_userId: { dailySalesEntryId: entryId, userId } },
            create: { dailySalesEntryId: entryId, userId, ...shared },
            update: shared,
            include: { user: { select: { id: true, fullName: true, email: true } } },
        });
    },

    getGoal: async (storeId: string) => {
        const goal = await prisma.dailySalesGoal.findFirst({
            where: { storeId },
            orderBy: { effectiveDate: 'desc' },
            select: { goal: true, effectiveDate: true },
        });
        return goal ? { goal: toNum(goal.goal), effectiveDate: goal.effectiveDate } : null;
    },

    setGoal: async (storeId: string, createdById: string, goal: number, effectiveDate: string) => {
        const [y, m, d] = effectiveDate.split('-').map(Number);
        const date = new Date(Date.UTC(y, m - 1, d));

        return prisma.dailySalesGoal.upsert({
            where: { storeId_effectiveDate: { storeId, effectiveDate: date } },
            create: { storeId, goal: new Prisma.Decimal(goal), effectiveDate: date, createdById },
            update: { goal: new Prisma.Decimal(goal), createdById },
        });
    },
};

type CashierEntryWithUser = {
    id: string;
    userId: string;
    cashAmount: Prisma.Decimal;
    gcashAmount: Prisma.Decimal;
    denom1000: number; denom500: number; denom200: number;
    denom100: number; denom50: number; denom20: number;
    coins: Prisma.Decimal;
    user: { id: string; fullName: string | null; email: string };
};

type EntryWithCashiers = {
    id: string;
    date: Date;
    expense: Prisma.Decimal;
    seniorDiscount: Prisma.Decimal;
    actualCoh: Prisma.Decimal | null;
    cashierEntries: CashierEntryWithUser[];
};

function buildRow(entry: EntryWithCashiers, pos: number, seniorDiscount: number, goal: number, prevSalesNeeded: number) {
    const totalCoh = entry.cashierEntries.reduce((s, c) => s + toNum(c.cashAmount), 0);
    const totalGcash = entry.cashierEntries.reduce((s, c) => s + toNum(c.gcashAmount), 0);
    const totalSenior = seniorDiscount;
    const expense = toNum(entry.expense);
    const totalSales = totalCoh + totalGcash + totalSenior + expense;
    const actualCoh = entry.actualCoh != null ? toNum(entry.actualCoh) : totalCoh;
    const kulangRemit = totalCoh - actualCoh;
    const shortIf = totalSales - pos;
    const salesNeeded = prevSalesNeeded + (goal - totalSales);

    return {
        id: entry.id,
        date: entry.date,
        expense,
        actualCoh,
        cashierEntries: entry.cashierEntries.map((c) => ({
            id: c.id,
            userId: c.userId,
            userName: c.user.fullName || c.user.email,
            cashAmount: toNum(c.cashAmount),
            gcashAmount: toNum(c.gcashAmount),
            denom1000: c.denom1000,
            denom500: c.denom500,
            denom200: c.denom200,
            denom100: c.denom100,
            denom50: c.denom50,
            denom20: c.denom20,
            coins: toNum(c.coins),
        })),
        totalCoh,
        totalGcash,
        totalSenior,
        totalSales,
        pos,
        kulangRemit,
        shortIf,
        salesNeeded,
    };
}
