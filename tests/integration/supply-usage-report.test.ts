import { beforeEach, describe, expect, it } from 'vitest';
import { IngredientCategory, MovementType, PaymentMethod, SaleStatus } from '@prisma/client';
import prisma from '../../lib/prisma';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

const login = async (agent: ReturnType<typeof createTestApp>, email: string, password: string) => {
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

describe('supply usage report', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('reports usage, cost, daily rate, days left and cost per 1,000 sales', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id);

        const gloves = await prisma.ingredient.create({
            data: { storeId: store.id, name: 'Gloves', unit: 'pair', category: IngredientCategory.SUPPLY, costPerUnit: 2 },
        });
        const bags = await prisma.ingredient.create({
            data: { storeId: store.id, name: 'Trash bag', unit: 'pc', category: IngredientCategory.SUPPLY, costPerUnit: 5 },
        });
        await prisma.ingredient.create({
            data: { storeId: store.id, name: 'Old mop', unit: 'pc', category: IngredientCategory.SUPPLY, costPerUnit: 1, active: false },
        });
        const milk = await prisma.ingredient.create({
            data: { storeId: store.id, name: 'Milk', unit: 'L', category: IngredientCategory.RAW_MATERIAL, costPerUnit: 90 },
        });

        await prisma.inventoryMovement.createMany({
            data: [
                // History starts 10 days ago, so the rate window is 11 days (not 28).
                { storeId: store.id, itemType: 'INGREDIENT', itemId: gloves.id, qtyDelta: 100, type: MovementType.STOCK_ADJUSTMENT, createdAt: daysAgo(10) },
                { storeId: store.id, itemType: 'INGREDIENT', itemId: gloves.id, qtyDelta: -22, unitCost: 2, type: MovementType.USAGE, createdAt: daysAgo(2) },
                // No cost snapshot: falls back to the current cost per unit (2).
                { storeId: store.id, itemType: 'INGREDIENT', itemId: gloves.id, qtyDelta: -11, type: MovementType.USAGE, createdAt: daysAgo(1) },
                { storeId: store.id, itemType: 'INGREDIENT', itemId: bags.id, qtyDelta: 30, type: MovementType.STOCK_ADJUSTMENT, createdAt: daysAgo(5) },
                // Raw materials never show up in the supply report.
                { storeId: store.id, itemType: 'INGREDIENT', itemId: milk.id, qtyDelta: -5, type: MovementType.SALE, createdAt: daysAgo(1) },
            ],
        });

        await prisma.sale.create({
            data: {
                storeId: store.id,
                cashierId: user.id,
                status: SaleStatus.FINALIZED,
                subtotal: 1000,
                discount: 0,
                tax: 0,
                total: 1000,
                paymentMethod: PaymentMethod.CASH,
                finalizedAt: new Date(),
            },
        });

        const agent = createTestApp();
        const token = await login(agent, user.email, password);
        const res = await agent
            .get(`/api/v1/stores/${store.id}/reports/supply-usage`)
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.summary).toMatchObject({ totalCost: 66, netSales: 1000, costPerThousandSales: 66 });
        expect(res.body.supplies.map((s: { name: string }) => s.name)).toEqual(['Gloves', 'Trash bag']);

        const glovesRow = res.body.supplies[0];
        expect(glovesRow).toMatchObject({ qtyUsed: 33, cost: 66, currentQty: 67, avgDailyUse: 3, daysLeft: 22 });

        const bagsRow = res.body.supplies[1];
        expect(bagsRow).toMatchObject({ qtyUsed: 0, cost: 0, currentQty: 30, avgDailyUse: 0, daysLeft: null });
    });
});
