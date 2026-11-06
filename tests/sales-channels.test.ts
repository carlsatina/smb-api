import { OrderType, PaymentMethod, Prisma, ProductType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../lib/prisma';
import { applyRounding, computeChannelPrice, normalizeSalesChannels, SalesChannel } from '../src/shared/salesChannels';
import { saleService } from '../src/modules/sales/sale.service';

vi.mock('../lib/prisma', () => {
    const sale = { create: vi.fn(), aggregate: vi.fn(), findFirst: vi.fn() };
    const saleItem = { createMany: vi.fn() };
    const inventoryMovement = { createMany: vi.fn(), groupBy: vi.fn() };
    const tx = { sale, saleItem, inventoryMovement };
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

const grab: SalesChannel = {
    key: 'GRAB',
    name: 'Grab',
    markupPercent: 25,
    rounding: 'NEAREST_1',
    alwaysTakeout: true,
    active: true,
};

describe('channel pricing', () => {
    it('applies each rounding rule to a +25% price', () => {
        const raw = 90 * 1.25; // 112.5
        expect(applyRounding(raw, 'NONE')).toBe(112.5);
        expect(applyRounding(raw, 'NEAREST_1')).toBe(113);
        expect(applyRounding(raw, 'NEAREST_5')).toBe(115);
        expect(applyRounding(raw, 'UP_5')).toBe(115);
        expect(applyRounding(raw, 'NEAREST_10')).toBe(110);
        expect(applyRounding(110, 'UP_5')).toBe(110);
    });

    it('uses a product override instead of the markup', () => {
        expect(computeChannelPrice(90, grab)).toBe(113);
        expect(computeChannelPrice(90, grab, 120)).toBe(120);
        expect(computeChannelPrice(90, grab, null)).toBe(113);
    });

    it('keeps existing keys and derives new ones from the name', () => {
        const result = normalizeSalesChannels(
            [
                { ...grab, key: 'GRAB', name: 'Grab Food' },
                { ...grab, key: null, name: 'food panda' },
            ],
            [grab]
        );
        expect(result.map((channel) => channel.key)).toEqual(['GRAB', 'FOOD_PANDA']);
        expect(result[0].name).toBe('Grab Food');
    });
});

describe('channel keys stay stable', () => {
    it('never gives an existing key to a new channel, whatever the order', () => {
        const result = normalizeSalesChannels(
            [
                { ...grab, key: null, name: 'Grab' },
                { ...grab, key: 'GRAB', name: 'Grab Food' },
            ],
            [grab]
        );
        expect(result.find((channel) => channel.name === 'Grab Food')?.key).toBe('GRAB');
        expect(result.find((channel) => channel.name === 'Grab')?.key).toBe('GRAB_2');
    });

    it('keeps saved channels that were left out, turned off', () => {
        const result = normalizeSalesChannels([], [grab]);
        expect(result).toEqual([{ ...grab, active: false }]);
    });
});

describe('finalizing a channel sale', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.store.findFirst.mockResolvedValue({
            id: 's1',
            allowNegativeStock: true,
            salesChannels: [grab],
        } as never);
        prismaMock.product.findMany.mockResolvedValue([
            {
                id: 'p1',
                name: 'Classic Lemonade',
                type: ProductType.READY_MADE,
                active: true,
                cost: new Prisma.Decimal(20),
                price: new Prisma.Decimal(90),
                channelPrices: {},
                unavailableChannels: [],
            },
            {
                id: 'p2',
                name: 'Lemon Shake',
                type: ProductType.READY_MADE,
                active: true,
                cost: new Prisma.Decimal(30),
                price: new Prisma.Decimal(100),
                channelPrices: { GRAB: 130 },
                unavailableChannels: [],
            },
        ] as never);
        prismaMock.productPackaging.findMany.mockResolvedValue([]);
        prismaMock.recipeLine.findMany.mockResolvedValue([]);
        prismaMock.ingredient.findMany.mockResolvedValue([]);
        prismaMock.sale.aggregate.mockResolvedValue({ _max: { receiptNumber: 7 } } as never);
        prismaMock.sale.create.mockResolvedValue({ id: 'sale-1' } as never);
        prismaMock.sale.findFirst.mockResolvedValue({
            id: 'sale-1',
            receiptNumber: 8,
            status: 'FINALIZED',
            subtotal: new Prisma.Decimal(0),
            discount: new Prisma.Decimal(0),
            tax: new Prisma.Decimal(0),
            total: new Prisma.Decimal(0),
            paymentMethod: PaymentMethod.CASH,
            orderType: OrderType.TAKEOUT,
            channel: 'GRAB',
            createdAt: new Date(),
            finalizedAt: new Date(),
            voidedAt: null,
            editedAt: null,
            cashier: null,
            items: [],
        } as never);
    });

    it('prices lines server-side, records base prices, the channel, and forces takeout', async () => {
        await saleService.finalize('s1', 'u1', {
            items: [
                { productId: 'p1', qty: 2, unitPrice: 90 }, // client sent store price
                { productId: 'p2', qty: 1, unitPrice: 100 },
            ],
            paymentMethod: PaymentMethod.CASH,
            orderType: OrderType.DINE_IN,
            channel: 'GRAB',
        });

        const saleData = prismaMock.sale.create.mock.calls[0]?.[0]?.data;
        expect(saleData).toMatchObject({ channel: 'GRAB', orderType: OrderType.TAKEOUT });
        expect(Number(saleData?.total)).toBe(113 * 2 + 130);

        const items = prismaMock.saleItem.createMany.mock.calls[0]?.[0]?.data as Array<Record<string, unknown>>;
        expect(items.map((item) => [Number(item.unitPrice), Number(item.basePrice)])).toEqual([
            [113, 90],
            [130, 100],
        ]);
    });

    it('rejects products that are not sold on the channel', async () => {
        const [lemonade, shake] = (await prismaMock.product.findMany({} as never)) as unknown as Array<Record<string, unknown>>;
        prismaMock.product.findMany.mockResolvedValueOnce([lemonade, { ...shake, unavailableChannels: ['GRAB'] }] as never);
        await expect(
            saleService.finalize('s1', 'u1', {
                items: [
                    { productId: 'p1', qty: 1, unitPrice: 90 },
                    { productId: 'p2', qty: 1, unitPrice: 100 },
                ],
                paymentMethod: PaymentMethod.CASH,
                orderType: OrderType.DINE_IN,
                channel: 'GRAB',
            })
        ).rejects.toMatchObject({ code: 'PRODUCT_NOT_ON_CHANNEL' });
        expect(prismaMock.sale.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown or disabled channel', async () => {
        await expect(
            saleService.finalize('s1', 'u1', {
                items: [{ productId: 'p1', qty: 1, unitPrice: 90 }],
                paymentMethod: PaymentMethod.CASH,
                orderType: OrderType.DINE_IN,
                channel: 'FOODPANDA',
            })
        ).rejects.toMatchObject({ code: 'INVALID_CHANNEL' });
    });

    it('leaves walk-in sales at the submitted price with no channel', async () => {
        const [lemonade] = (await prismaMock.product.findMany({} as never)) as unknown as unknown[];
        prismaMock.product.findMany.mockResolvedValueOnce([lemonade] as never);
        await saleService.finalize('s1', 'u1', {
            items: [{ productId: 'p1', qty: 1, unitPrice: 90 }],
            paymentMethod: PaymentMethod.CASH,
            orderType: OrderType.DINE_IN,
        });
        expect(prismaMock.sale.create.mock.calls[0]?.[0]?.data).toMatchObject({
            channel: null,
            orderType: OrderType.DINE_IN,
        });
    });
});
