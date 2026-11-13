import { beforeEach, describe, expect, it } from 'vitest';
import { IngredientCategory, MovementType, SupplyCostBasis } from '@prisma/client';
import prisma from '../../lib/prisma';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

const login = async (agent: ReturnType<typeof createTestApp>, email: string, password: string) => {
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

// Expenses are date-only (UTC midnight) in the store's calendar; the store is Asia/Manila.
const todayInManila = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const seed = async () => {
    const { user, password } = await createUser();
    const store = await createStoreWithOwner(user.id);
    const gloves = await prisma.ingredient.create({
        data: { storeId: store.id, name: 'Gloves', unit: 'pair', category: IngredientCategory.SUPPLY, costPerUnit: 2 },
    });
    const date = new Date(`${todayInManila()}T00:00:00Z`);
    await prisma.expense.createMany({
        data: [
            // A bulk supply purchase that should not hit this period on a usage basis.
            { storeId: store.id, date, amount: 3000, category: 'Supplies', createdById: user.id },
            { storeId: store.id, date, amount: 1000, category: 'Utilities', createdById: user.id },
        ],
    });
    await prisma.inventoryMovement.create({
        data: { storeId: store.id, itemType: 'INGREDIENT', itemId: gloves.id, qtyDelta: -50, unitCost: 2, type: MovementType.USAGE },
    });
    const agent = createTestApp();
    const token = await login(agent, user.email, password);
    return { store, agent, token };
};

describe('supply cost basis', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('deducts logged supply expenses on the default purchase basis', async () => {
        const { store, agent, token } = await seed();

        const res = await agent
            .get(`/api/v1/stores/${store.id}/reports/expense-summary`)
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(4000);
        expect(res.body.profitDeduction).toBe(4000);
        expect(res.body.supplies).toMatchObject({ basis: 'PURCHASE', purchased: 3000, used: 0 });
    });

    it('swaps supply expenses for supplies used on the usage basis', async () => {
        const { store, agent, token } = await seed();

        const update = await agent
            .patch(`/api/v1/stores/${store.id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ supplyCostBasis: 'USAGE' });
        expect(update.status).toBe(200);
        expect((await prisma.store.findUnique({ where: { id: store.id } }))?.supplyCostBasis).toBe(SupplyCostBasis.USAGE);

        // The switch is audited once; re-saving the same value (as the settings form does) adds nothing.
        const resave = await agent
            .patch(`/api/v1/stores/${store.id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ supplyCostBasis: 'USAGE', name: 'Renamed' });
        expect(resave.status).toBe(200);
        const audits = await prisma.auditLog.findMany({ where: { storeId: store.id, action: 'SUPPLY_COST_BASIS_UPDATED' } });
        expect(audits).toHaveLength(1);
        expect(audits[0].meta).toMatchObject({ from: 'PURCHASE', to: 'USAGE' });

        const res = await agent
            .get(`/api/v1/stores/${store.id}/reports/expense-summary`)
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        // Expenses still list everything that was logged…
        expect(res.body.total).toBe(4000);
        // …but profit subtracts 1000 utilities + 100 of gloves used (50 × 2), not the 3000 purchase.
        expect(res.body.profitDeduction).toBe(1100);
        expect(res.body.supplies).toMatchObject({ basis: 'USAGE', purchased: 3000, used: 100 });
    });
});
