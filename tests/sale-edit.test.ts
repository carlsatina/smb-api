import { ItemType, MovementType, OrderType, PaymentMethod, Prisma, ProductType, SaleStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../lib/prisma';
import { computeEditDeltas, saleService } from '../src/modules/sales/sale.service';

vi.mock('../lib/prisma', () => {
    const sale = { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() };
    const saleItem = { deleteMany: vi.fn(), createMany: vi.fn() };
    const inventoryMovement = { groupBy: vi.fn(), createMany: vi.fn() };
    const auditLog = { create: vi.fn() };
    const tx = { sale, saleItem, inventoryMovement, auditLog };
    return {
        default: {
            ...tx,
            store: { findFirst: vi.fn() },
            product: { findMany: vi.fn() },
            ingredient: { findMany: vi.fn() },
            recipeLine: { findMany: vi.fn() },
            productPackaging: { findMany: vi.fn() },
            $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)),
        },
    };
});

const prismaMock = vi.mocked(prisma, { deep: true });
const dec = (v: number) => new Prisma.Decimal(v);

const saleRow = (overrides: Partial<{ status: SaleStatus; voidedAt: Date | null }> = {}) => ({
    id: 'sale-1',
    storeId: 'store-1',
    cashierId: 'cashier-1',
    status: SaleStatus.FINALIZED,
    receiptNumber: 12,
    subtotal: dec(100),
    discount: dec(0),
    tax: dec(0),
    total: dec(100),
    paymentMethod: PaymentMethod.CASH,
    orderType: OrderType.DINE_IN,
    createdAt: new Date('2026-11-01T03:00:00Z'),
    finalizedAt: new Date('2026-11-01T03:00:00Z'),
    voidedAt: null,
    editedAt: null,
    deletedAt: null,
    cashier: { id: 'cashier-1', fullName: 'Cashier', email: 'c@example.com' },
    items: [
        {
            id: 'si-1',
            saleId: 'sale-1',
            productId: 'prod-a',
            qty: dec(2),
            unitPrice: dec(50),
            discount: dec(0),
            tax: dec(0),
            total: dec(100),
            nameSnapshot: 'Bottled Water',
            product: { id: 'prod-a', name: 'Bottled Water', sku: null, unit: 'pc', type: ProductType.READY_MADE },
        },
    ],
    ...overrides,
});

describe('computeEditDeltas', () => {
    it('returns only the net difference between existing and next consumption', () => {
        const existing = [
            { itemType: ItemType.PRODUCT, itemId: 'a', qtyDelta: -2 },
            { itemType: ItemType.INGREDIENT, itemId: 'milk', qtyDelta: -0.3 },
        ];
        const next = [
            { itemType: ItemType.PRODUCT, itemId: 'a', qtyDelta: -2 },
            { itemType: ItemType.INGREDIENT, itemId: 'milk', qtyDelta: -0.1 },
            { itemType: ItemType.PRODUCT, itemId: 'b', qtyDelta: -1 },
        ];
        expect(computeEditDeltas(existing, next)).toEqual([
            { itemType: ItemType.INGREDIENT, itemId: 'milk', qtyDelta: 0.2 },
            { itemType: ItemType.PRODUCT, itemId: 'b', qtyDelta: -1 },
        ]);
    });

    it('returns stock for items removed from the sale', () => {
        const existing = [{ itemType: ItemType.PRODUCT, itemId: 'a', qtyDelta: -3 }];
        expect(computeEditDeltas(existing, [])).toEqual([{ itemType: ItemType.PRODUCT, itemId: 'a', qtyDelta: 3 }]);
    });
});

describe('saleService.update', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.store.findFirst.mockResolvedValue({ id: 'store-1', allowNegativeStock: true } as never);
        prismaMock.recipeLine.findMany.mockResolvedValue([]);
        prismaMock.productPackaging.findMany.mockResolvedValue([]);
        prismaMock.ingredient.findMany.mockResolvedValue([]);
        prismaMock.sale.updateMany.mockResolvedValue({ count: 1 });
    });

    it('rejects voided sales', async () => {
        prismaMock.sale.findFirst.mockResolvedValue(saleRow({ status: SaleStatus.VOIDED }) as never);
        await expect(
            saleService.update('store-1', 'owner-1', 'sale-1', {
                items: [{ productId: 'prod-a', qty: 1, unitPrice: 50 }],
                paymentMethod: PaymentMethod.CASH,
                orderType: OrderType.DINE_IN,
            })
        ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('updates totals, replaces items, posts only the net stock change, and writes an audit log', async () => {
        prismaMock.sale.findFirst.mockResolvedValue(saleRow() as never);
        prismaMock.product.findMany.mockImplementation((async (args: { select: Record<string, boolean> }) =>
            args.select.type
                ? [{ id: 'prod-a', name: 'Bottled Water', type: ProductType.READY_MADE, active: false, cost: dec(20) }]
                : [{ id: 'prod-a', name: 'Bottled Water', cost: dec(20) }]) as never);
        prismaMock.inventoryMovement.groupBy.mockResolvedValue([
            { itemType: ItemType.PRODUCT, itemId: 'prod-a', _sum: { qtyDelta: dec(-2) } },
        ] as never);

        await saleService.update('store-1', 'owner-1', 'sale-1', {
            items: [{ productId: 'prod-a', qty: 1, unitPrice: 50 }],
            paymentMethod: PaymentMethod.GCASH,
            orderType: OrderType.DINE_IN,
        });

        const updateArgs = prismaMock.sale.updateMany.mock.calls[0]?.[0];
        expect(updateArgs?.data).toMatchObject({ paymentMethod: PaymentMethod.GCASH });
        expect(Number(updateArgs?.data.total)).toBe(50);

        expect(prismaMock.saleItem.deleteMany).toHaveBeenCalledWith({ where: { saleId: 'sale-1' } });

        const movements = prismaMock.inventoryMovement.createMany.mock.calls[0]?.[0]?.data as Array<Record<string, unknown>>;
        expect(movements).toHaveLength(1);
        expect(Number(movements[0].qtyDelta)).toBe(1);
        expect(movements[0]).toMatchObject({
            type: MovementType.SALE,
            referenceType: 'SALE_EDIT',
            referenceId: 'sale-1',
            createdAt: new Date('2026-11-01T03:00:00Z'),
        });

        expect(prismaMock.auditLog.create.mock.calls[0]?.[0]?.data).toMatchObject({
            action: 'SALE_EDITED',
            entityId: 'sale-1',
        });
    });
});

describe('editing a Grab sale', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.store.findFirst.mockResolvedValue({
            id: 'store-1',
            allowNegativeStock: true,
            salesChannels: [
                { key: 'GRAB', name: 'Grab', markupPercent: 25, rounding: 'NEAREST_1', alwaysTakeout: true, active: true },
            ],
        } as never);
        prismaMock.recipeLine.findMany.mockResolvedValue([]);
        prismaMock.productPackaging.findMany.mockResolvedValue([]);
        prismaMock.ingredient.findMany.mockResolvedValue([]);
        prismaMock.inventoryMovement.groupBy.mockResolvedValue([]);
        prismaMock.sale.updateMany.mockResolvedValue({ count: 1 });
    });

    it('keeps existing line prices, prices new lines server-side, and stays takeout', async () => {
        const grabSale = saleRow();
        Object.assign(grabSale, { channel: 'GRAB', orderType: OrderType.TAKEOUT });
        grabSale.items[0] = { ...grabSale.items[0], unitPrice: dec(113), basePrice: dec(90) } as never;
        prismaMock.sale.findFirst.mockResolvedValue(grabSale as never);
        prismaMock.product.findMany.mockImplementation((async (args: { select: Record<string, boolean> }) =>
            args.select.type
                ? [
                      { id: 'prod-a', name: 'Bottled Water', type: ProductType.READY_MADE, active: true, cost: dec(20), price: dec(95), channelPrices: {}, unavailableChannels: [] },
                      { id: 'prod-b', name: 'Lemon Shake', type: ProductType.READY_MADE, active: true, cost: dec(30), price: dec(100), channelPrices: {}, unavailableChannels: [] },
                  ]
                : []) as never);

        await saleService.update('store-1', 'owner-1', 'sale-1', {
            items: [
                { productId: 'prod-a', qty: 1, unitPrice: 1 },
                { productId: 'prod-b', qty: 1, unitPrice: 1 },
            ],
            paymentMethod: PaymentMethod.CASH,
            orderType: OrderType.DINE_IN,
        });

        expect(prismaMock.sale.updateMany.mock.calls[0]?.[0]?.data).toMatchObject({ orderType: OrderType.TAKEOUT });
        const items = prismaMock.saleItem.createMany.mock.calls[0]?.[0]?.data as Array<Record<string, unknown>>;
        expect(items.map((item) => [Number(item.unitPrice), Number(item.basePrice)])).toEqual([
            [113, 90], // existing line: original Grab price and original store price
            [125, 100], // new line: +25% of today's price
        ]);
    });
});

describe('deleting a sale', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.sale.updateMany.mockResolvedValue({ count: 1 });
        prismaMock.product.findMany.mockResolvedValue([{ id: 'prod-a', cost: dec(20) }] as never);
        prismaMock.ingredient.findMany.mockResolvedValue([]);
    });

    it('soft-deletes a finalized sale, returns its stock, and audits a snapshot', async () => {
        prismaMock.sale.findFirst.mockResolvedValue(saleRow() as never);
        prismaMock.inventoryMovement.groupBy.mockResolvedValue([
            { itemType: ItemType.PRODUCT, itemId: 'prod-a', _sum: { qtyDelta: dec(-2) } },
        ] as never);

        const result = await saleService.deleteSale('store-1', 'owner-1', 'sale-1', ' Duplicate ticket ');

        expect(result.stockReturned).toBe(true);
        expect(prismaMock.sale.updateMany.mock.calls[0]?.[0]?.data).toHaveProperty('deletedAt');
        const movements = prismaMock.inventoryMovement.createMany.mock.calls[0]?.[0]?.data as Array<Record<string, unknown>>;
        expect(Number(movements[0].qtyDelta)).toBe(2);
        expect(movements[0]).toMatchObject({ type: MovementType.SALE, referenceType: 'SALE_DELETE', referenceId: 'sale-1' });
        expect(prismaMock.auditLog.create.mock.calls[0]?.[0]?.data).toMatchObject({
            action: 'SALE_DELETED',
            entityId: 'sale-1',
            meta: { itemName: 'Receipt #12', reason: 'Duplicate ticket', total: 100, stockReturned: true },
        });
    });

    it('does not move stock again for a voided sale', async () => {
        prismaMock.sale.findFirst.mockResolvedValue(
            saleRow({ status: SaleStatus.VOIDED, voidedAt: new Date() }) as never
        );
        await saleService.deleteSale('store-1', 'owner-1', 'sale-1');
        expect(prismaMock.inventoryMovement.groupBy).not.toHaveBeenCalled();
        expect(prismaMock.inventoryMovement.createMany).not.toHaveBeenCalled();
        expect(prismaMock.auditLog.create.mock.calls[0]?.[0]?.data).toMatchObject({
            action: 'SALE_DELETED',
            meta: { stockReturned: false, reason: null },
        });
    });
});

describe('deleting all sales', () => {
    const day = (d: number) => new Date(`2026-11-0${d}T03:00:00Z`);

    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.product.findMany.mockResolvedValue([{ id: 'prod-a', cost: dec(20) }] as never);
        prismaMock.ingredient.findMany.mockResolvedValue([]);
    });

    it('soft-deletes every sale, returns stock only for finalized ones, and audits once', async () => {
        prismaMock.sale.findMany.mockResolvedValue([
            { id: 'sale-1', status: SaleStatus.FINALIZED, voidedAt: null, createdAt: day(1), total: dec(100) },
            { id: 'sale-2', status: SaleStatus.VOIDED, voidedAt: day(2), createdAt: day(2), total: dec(50) },
        ] as never);
        prismaMock.sale.updateMany.mockResolvedValue({ count: 2 });
        prismaMock.inventoryMovement.groupBy.mockResolvedValue([
            { referenceId: 'sale-1', itemType: ItemType.PRODUCT, itemId: 'prod-a', _sum: { qtyDelta: dec(-2) } },
        ] as never);

        const result = await saleService.deleteAllSales('store-1', 'owner-1', 'Clearing test data');

        expect(result).toEqual({ deletedCount: 2, stockReturned: true });
        const groupWhere = prismaMock.inventoryMovement.groupBy.mock.calls[0]?.[0]?.where as Record<string, any>;
        expect(groupWhere.referenceId).toEqual({ in: ['sale-1'] });
        const movements = prismaMock.inventoryMovement.createMany.mock.calls[0]?.[0]?.data as Array<Record<string, unknown>>;
        expect(movements).toHaveLength(1);
        expect(Number(movements[0].qtyDelta)).toBe(2);
        expect(movements[0]).toMatchObject({ referenceType: 'SALE_DELETE', referenceId: 'sale-1', createdAt: day(1) });
        expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
        expect(prismaMock.auditLog.create.mock.calls[0]?.[0]?.data).toMatchObject({
            action: 'SALES_DELETED_ALL',
            meta: { deletedCount: 2, finalizedCount: 1, voidedCount: 1, finalizedTotal: 100, reason: 'Clearing test data' },
        });
    });

    it('rolls back if some sales were removed meanwhile', async () => {
        prismaMock.sale.findMany.mockResolvedValue([
            { id: 'sale-1', status: SaleStatus.VOIDED, voidedAt: day(1), createdAt: day(1), total: dec(100) },
            { id: 'sale-2', status: SaleStatus.VOIDED, voidedAt: day(2), createdAt: day(2), total: dec(50) },
        ] as never);
        prismaMock.sale.updateMany.mockResolvedValue({ count: 1 });

        await expect(saleService.deleteAllSales('store-1', 'owner-1')).rejects.toMatchObject({ statusCode: 409 });
        expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    it('does nothing when there are no sales', async () => {
        prismaMock.sale.findMany.mockResolvedValue([]);
        const result = await saleService.deleteAllSales('store-1', 'owner-1');
        expect(result).toEqual({ deletedCount: 0, stockReturned: false });
        expect(prismaMock.sale.updateMany).not.toHaveBeenCalled();
    });
});
