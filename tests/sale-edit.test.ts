import { ItemType, MovementType, OrderType, PaymentMethod, Prisma, ProductType, SaleStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../lib/prisma';
import { computeEditDeltas, saleService } from '../src/modules/sales/sale.service';

vi.mock('../lib/prisma', () => {
    const sale = { findFirst: vi.fn(), updateMany: vi.fn() };
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
