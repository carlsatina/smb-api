import { beforeEach, describe, expect, it } from 'vitest';
import { PlanTier, Prisma, Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

const login = async (agent: ReturnType<typeof createTestApp>, email: string, password: string) => {
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

const grantDailySales = (userId: string, grantedById: string) =>
    prisma.userFeature.create({ data: { userId, feature: 'DAILY_SALES', grantedById } });

const addExpense = (storeId: string, createdById: string, date: string, amount: number, category: string) =>
    prisma.expense.create({
        data: {
            storeId,
            createdById,
            date: new Date(`${date}T00:00:00.000Z`),
            amount: new Prisma.Decimal(amount),
            category,
        },
    });

const findDay = (rows: any[], date: string) =>
    rows.find((r) => String(r.date).slice(0, 10) === date);

describe('daily-sales expense derivation', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('derives expense from itemized expenses, role-filtered, and honors overrides', async () => {
        const { user: owner, password: ownerPw } = await createUser({ planTier: PlanTier.STANDARD });
        const store = await createStoreWithOwner(owner.id, { timezone: 'UTC' });
        await grantDailySales(owner.id, owner.id);

        const { user: cashier, password: cashierPw } = await createUser();
        await prisma.storeMember.create({ data: { storeId: store.id, userId: cashier.id, role: Role.CASHIER } });
        await grantDailySales(cashier.id, owner.id);

        const date = '2026-06-10';
        await addExpense(store.id, owner.id, date, 500, 'Rent');
        await addExpense(store.id, owner.id, date, 30, 'Supplies');

        // Daily-sales entry with no override (expense = null ⇒ derive).
        await prisma.dailySalesEntry.create({
            data: { storeId: store.id, date: new Date(Date.UTC(2026, 5, 10)), expense: null, createdById: owner.id },
        });

        const ownerAgent = createTestApp();
        const ownerToken = await login(ownerAgent, owner.email, ownerPw);
        const ownerRes = await ownerAgent
            .get(`/api/v1/stores/${store.id}/daily-sales?year=2026&month=6`)
            .set('Authorization', `Bearer ${ownerToken}`);
        expect(ownerRes.status).toBe(200);
        const ownerRow = findDay(ownerRes.body.rows, date);
        expect(ownerRow.expenseOverride).toBeNull();
        expect(ownerRow.expenseDerived).toBe(530); // Rent + Supplies
        expect(ownerRow.expense).toBe(530);

        // Cashier: Rent excluded from the derived value.
        const cashierAgent = createTestApp();
        const cashierToken = await login(cashierAgent, cashier.email, cashierPw);
        const cashierRes = await cashierAgent
            .get(`/api/v1/stores/${store.id}/daily-sales?year=2026&month=6`)
            .set('Authorization', `Bearer ${cashierToken}`);
        expect(cashierRes.status).toBe(200);
        const cashierRow = findDay(cashierRes.body.rows, date);
        expect(cashierRow.expenseDerived).toBe(30); // Supplies only
        expect(cashierRow.expense).toBe(30);

        // Owner sets a manual override → it wins over the derived value.
        const entryId = ownerRow.id;
        const patch = await ownerAgent
            .patch(`/api/v1/stores/${store.id}/daily-sales/${entryId}`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ expense: 999 });
        expect(patch.status).toBe(200);

        const afterRes = await ownerAgent
            .get(`/api/v1/stores/${store.id}/daily-sales?year=2026&month=6`)
            .set('Authorization', `Bearer ${ownerToken}`);
        const afterRow = findDay(afterRes.body.rows, date);
        expect(afterRow.expenseOverride).toBe(999);
        expect(afterRow.expense).toBe(999);
        expect(afterRow.expenseDerived).toBe(530);
    });
});
