import { Prisma, Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../lib/prisma';
import { computeHomeStock, dailyInventoryService } from '../src/modules/dailyInventory/dailyInventory.service';

vi.mock('../lib/prisma', () => {
    const dailyInventoryReport = {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
    };
    const dailyInventoryReportItem = {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
    };
    return {
        default: {
            dailyInventoryReport,
            dailyInventoryReportItem,
            $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({ dailyInventoryReport, dailyInventoryReportItem })),
        },
    };
});

const prismaMock = vi.mocked(prisma, { deep: true });

const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));

const dbItem = (overrides: {
    particulars: string;
    openingInventory?: number;
    delivery?: number;
    endingInventory?: number | null;
    homeStockOpening?: number | null;
}) => ({
    id: `item-${overrides.particulars}`,
    reportId: 'rep-1',
    section: 'Main',
    particulars: overrides.particulars,
    unit: 'pcs',
    openingInventory: dec(overrides.openingInventory ?? 0),
    delivery: dec(overrides.delivery ?? 0),
    endingInventory: dec(overrides.endingInventory ?? null),
    homeStockOpening: dec(overrides.homeStockOpening ?? null),
    reminders: null,
    sortOrder: 1,
    itemType: null,
    itemId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
});

const dbReport = (date: string, items: ReturnType<typeof dbItem>[]) => ({
    id: 'rep-1',
    storeId: 'store-1',
    reportType: 'TAKOYAKI',
    date: new Date(`${date}T00:00:00.000Z`),
    createdById: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    items,
});

type SavedItems = Array<Record<string, unknown>>;

const savedItemsOfCall = (call: number) =>
    (prismaMock.dailyInventoryReportItem.createMany.mock.calls[call][0] as unknown as { data: SavedItems }).data;

const savedItems = () => savedItemsOfCall(0);

describe('computeHomeStock', () => {
    it('deducts delivery from the starting home stock', () => {
        expect(computeHomeStock(20, 5)).toBe(15);
    });

    it('returns null when home stock is not tracked', () => {
        expect(computeHomeStock(null, 5)).toBeNull();
    });

    it('goes negative when delivery exceeds home stock', () => {
        expect(computeHomeStock(3, 5)).toBe(-2);
    });
});

describe('Daily inventory home stock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.dailyInventoryReport.upsert.mockResolvedValue({ id: 'rep-1' } as never);
    });

    it('returns remaining home stock as starting home stock minus delivery', async () => {
        prismaMock.dailyInventoryReport.findUnique.mockResolvedValue(
            dbReport('2026-10-12', [
                dbItem({ particulars: 'Eggs', delivery: 5, homeStockOpening: 20 }),
                dbItem({ particulars: 'Cabbage', delivery: 2, homeStockOpening: null }),
            ]) as never
        );

        const report = await dailyInventoryService.getDailyReport('store-1', 'TAKOYAKI', '2026-10-12');

        expect(report.items[0]).toMatchObject({ homeStockOpening: 20, homeStock: 15 });
        expect(report.items[1]).toMatchObject({ homeStockOpening: null, homeStock: null });
    });

    it("carries over yesterday's remaining home stock as today's starting home stock", async () => {
        prismaMock.dailyInventoryReport.findUnique.mockResolvedValue(null as never);
        prismaMock.dailyInventoryReport.findFirst.mockResolvedValue(
            dbReport('2026-10-11', [
                dbItem({ particulars: 'Eggs', delivery: 5, endingInventory: 8, homeStockOpening: 20 }),
                dbItem({ particulars: 'Cabbage', delivery: 2, endingInventory: 1, homeStockOpening: null }),
            ]) as never
        );

        const report = await dailyInventoryService.getDailyReport('store-1', 'TAKOYAKI', '2026-10-12');

        const eggs = report.items.find((i) => i.particulars === 'Eggs');
        const cabbage = report.items.find((i) => i.particulars === 'Cabbage');
        expect(eggs).toMatchObject({ openingInventory: 8, delivery: 0, homeStockOpening: 15, homeStock: 15 });
        expect(cabbage).toMatchObject({ homeStockOpening: null, homeStock: null });
    });

    it('keeps the stored home stock when staff save, ignoring the submitted value', async () => {
        const existing = dbReport('2026-10-12', [dbItem({ particulars: 'Eggs', homeStockOpening: 20 })]);
        prismaMock.dailyInventoryReport.findUnique.mockResolvedValue(existing as never);

        await dailyInventoryService.saveDailyReport(
            'store-1',
            'TAKOYAKI',
            '2026-10-12',
            { items: [{ particulars: 'Eggs', unit: 'pcs', openingInventory: 0, delivery: 5, homeStockOpening: 999 }] },
            Role.CASHIER,
            'user-2'
        );

        const [eggs] = savedItems();
        expect(Number(eggs.homeStockOpening)).toBe(20);
        expect(Number(eggs.delivery)).toBe(5);
    });

    it("uses the carried-over home stock when staff create today's report", async () => {
        prismaMock.dailyInventoryReport.findUnique.mockResolvedValue(null as never);
        prismaMock.dailyInventoryReport.findFirst.mockResolvedValue(
            dbReport('2026-10-11', [dbItem({ particulars: 'Eggs', delivery: 4, endingInventory: 6, homeStockOpening: 10 })]) as never
        );

        await dailyInventoryService.saveDailyReport(
            'store-1',
            'TAKOYAKI',
            '2026-10-12',
            { items: [{ particulars: 'Eggs', unit: 'pcs', openingInventory: 0, delivery: 3, homeStockOpening: null }] },
            Role.INVENTORY_MANAGER,
            'user-2'
        );

        const [eggs] = savedItems();
        expect(Number(eggs.openingInventory)).toBe(6);
        expect(Number(eggs.homeStockOpening)).toBe(6);
    });

    it('lets owners and admins set home stock', async () => {
        prismaMock.dailyInventoryReport.findUnique.mockResolvedValue(
            dbReport('2026-10-12', [dbItem({ particulars: 'Eggs', homeStockOpening: 20 })]) as never
        );

        await dailyInventoryService.saveDailyReport(
            'store-1',
            'TAKOYAKI',
            '2026-10-12',
            { items: [{ particulars: 'Eggs', unit: 'pcs', openingInventory: 0, delivery: 5, homeStockOpening: 35 }] },
            Role.ADMIN,
            'user-1'
        );

        const [eggs] = savedItems();
        expect(Number(eggs.homeStockOpening)).toBe(35);
    });

    it('does not deduct the same delivery twice across repeated saves', async () => {
        const existing = dbReport('2026-10-12', [dbItem({ particulars: 'Eggs', delivery: 5, homeStockOpening: 20 })]);
        prismaMock.dailyInventoryReport.findUnique.mockResolvedValue(existing as never);
        const payload = { items: [{ particulars: 'Eggs', unit: 'pcs', openingInventory: 0, delivery: 5 }] };

        await dailyInventoryService.saveDailyReport('store-1', 'TAKOYAKI', '2026-10-12', payload, Role.CASHIER, 'user-2');
        await dailyInventoryService.saveDailyReport('store-1', 'TAKOYAKI', '2026-10-12', payload, Role.CASHIER, 'user-2');

        expect(Number(savedItemsOfCall(0)[0].homeStockOpening)).toBe(20);
        expect(Number(savedItemsOfCall(1)[0].homeStockOpening)).toBe(20);

        const report = await dailyInventoryService.getDailyReport('store-1', 'TAKOYAKI', '2026-10-12');
        expect(report.items[0].homeStock).toBe(15);
    });
});
