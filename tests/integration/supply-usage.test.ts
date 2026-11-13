import { beforeEach, describe, expect, it } from 'vitest';
import { IngredientCategory, MovementType } from '@prisma/client';
import prisma from '../../lib/prisma';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

const login = async (agent: ReturnType<typeof createTestApp>, email: string, password: string) => {
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

const createSupply = (storeId: string, name: string, costPerUnit = 2) =>
    prisma.ingredient.create({
        data: { storeId, name, unit: 'pc', category: IngredientCategory.SUPPLY, costPerUnit },
    });

const seedStock = (storeId: string, itemId: string, qty: number) =>
    prisma.inventoryMovement.create({
        data: { storeId, itemType: 'INGREDIENT', itemId, qtyDelta: qty, type: MovementType.STOCK_ADJUSTMENT },
    });

const stockOf = async (storeId: string, itemId: string) => {
    const result = await prisma.inventoryMovement.aggregate({
        where: { storeId, itemType: 'INGREDIENT', itemId },
        _sum: { qtyDelta: true },
    });
    return Number(result._sum.qtyDelta ?? 0);
};

const setup = async (storeInput: { allowNegativeStock?: boolean } = {}) => {
    const { user, password } = await createUser();
    const store = await createStoreWithOwner(user.id, storeInput);
    const agent = createTestApp();
    const token = await login(agent, user.email, password);
    return { store, agent, token };
};

describe('supply usage', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('records usage as USAGE movements at the current cost', async () => {
        const { store, agent, token } = await setup();
        const gloves = await createSupply(store.id, 'Gloves', 2.5);
        const bags = await createSupply(store.id, 'Trash bag', 4);
        await seedStock(store.id, gloves.id, 100);
        await seedStock(store.id, bags.id, 20);

        const res = await agent
            .post(`/api/v1/stores/${store.id}/inventory/supplies/usage`)
            .set('Authorization', `Bearer ${token}`)
            .send({ items: [{ itemId: gloves.id, qty: 10 }, { itemId: bags.id, qty: 2 }], note: 'Opened new box' });

        expect(res.status).toBe(201);
        expect(res.body.movements).toHaveLength(2);
        expect(await stockOf(store.id, gloves.id)).toBe(90);
        expect(await stockOf(store.id, bags.id)).toBe(18);

        const usage = await prisma.inventoryMovement.findFirst({ where: { itemId: gloves.id, type: MovementType.USAGE } });
        expect(Number(usage?.unitCost)).toBe(2.5);
        expect(usage?.referenceType).toBe('SUPPLY_USAGE');

        const audit = await prisma.auditLog.findFirst({ where: { storeId: store.id, action: 'SUPPLY_USAGE' } });
        expect(audit).not.toBeNull();
    });

    it('refuses usage that would go negative when the store blocks it', async () => {
        const { store, agent, token } = await setup({ allowNegativeStock: false });
        const gloves = await createSupply(store.id, 'Gloves');
        await seedStock(store.id, gloves.id, 5);

        const res = await agent
            .post(`/api/v1/stores/${store.id}/inventory/supplies/usage`)
            .set('Authorization', `Bearer ${token}`)
            .send({ items: [{ itemId: gloves.id, qty: 6 }] });

        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe('NEGATIVE_STOCK');
        expect(await stockOf(store.id, gloves.id)).toBe(5);
    });

    it('refuses non-supply items', async () => {
        const { store, agent, token } = await setup();
        const sugar = await prisma.ingredient.create({
            data: { storeId: store.id, name: 'Sugar', unit: 'g', category: IngredientCategory.RAW_MATERIAL, costPerUnit: 1 },
        });

        const res = await agent
            .post(`/api/v1/stores/${store.id}/inventory/supplies/usage`)
            .set('Authorization', `Bearer ${token}`)
            .send({ items: [{ itemId: sugar.id, qty: 1 }] });

        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe('NOT_A_SUPPLY');
    });
});

describe('supply count', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('turns a shortfall into usage, a surplus into an adjustment, and skips unchanged items', async () => {
        const { store, agent, token } = await setup();
        const gloves = await createSupply(store.id, 'Gloves', 2);
        const alcohol = await createSupply(store.id, 'Alcohol', 50);
        const bags = await createSupply(store.id, 'Trash bag', 4);
        await seedStock(store.id, gloves.id, 100);
        await seedStock(store.id, alcohol.id, 3);
        await seedStock(store.id, bags.id, 20);

        const res = await agent
            .post(`/api/v1/stores/${store.id}/inventory/supplies/count`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                counts: [
                    { itemId: gloves.id, countedQty: 70 },
                    { itemId: alcohol.id, countedQty: 4 },
                    { itemId: bags.id, countedQty: 20 },
                ],
                note: 'Weekly count',
            });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ counted: 3, usedItems: 1, surplusItems: 1, unchangedItems: 1, usageCost: 60 });

        expect(await stockOf(store.id, gloves.id)).toBe(70);
        expect(await stockOf(store.id, alcohol.id)).toBe(4);
        expect(await stockOf(store.id, bags.id)).toBe(20);

        const glovesUsage = await prisma.inventoryMovement.findFirst({
            where: { itemId: gloves.id, referenceType: 'SUPPLY_COUNT' },
        });
        expect(glovesUsage?.type).toBe(MovementType.USAGE);
        expect(Number(glovesUsage?.qtyDelta)).toBe(-30);

        const alcoholFix = await prisma.inventoryMovement.findFirst({
            where: { itemId: alcohol.id, referenceType: 'SUPPLY_COUNT' },
        });
        expect(alcoholFix?.type).toBe(MovementType.STOCK_ADJUSTMENT);

        const audit = await prisma.auditLog.findFirst({ where: { storeId: store.id, action: 'SUPPLY_COUNT' } });
        expect(audit).not.toBeNull();
    });
});
