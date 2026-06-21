import { beforeEach, describe, expect, it } from 'vitest';
import { PlanTier, Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

const login = async (agent: ReturnType<typeof createTestApp>, email: string, password: string) => {
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

describe('expense CRUD', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('lets an owner create, list, update and delete expenses (STANDARD plan)', async () => {
        const { user, password } = await createUser({ planTier: PlanTier.STANDARD });
        const store = await createStoreWithOwner(user.id);
        const agent = createTestApp();
        const token = await login(agent, user.email, password);
        const auth = (req: any) => req.set('Authorization', `Bearer ${token}`);

        const created = await auth(
            agent.post(`/api/v1/stores/${store.id}/expenses`).send({
                date: '2026-06-10',
                amount: 1500,
                category: 'Rent',
                note: 'June rent',
            })
        );
        expect(created.status).toBe(201);
        expect(created.body.expense.category).toBe('Rent');
        expect(Number(created.body.expense.amount)).toBe(1500);
        const expenseId = created.body.expense.id;

        const list = await auth(agent.get(`/api/v1/stores/${store.id}/expenses`));
        expect(list.status).toBe(200);
        expect(list.body.expenses).toHaveLength(1);

        const updated = await auth(
            agent.patch(`/api/v1/stores/${store.id}/expenses/${expenseId}`).send({ amount: 1750 })
        );
        expect(updated.status).toBe(200);
        expect(Number(updated.body.expense.amount)).toBe(1750);

        const removed = await auth(agent.delete(`/api/v1/stores/${store.id}/expenses/${expenseId}`));
        expect(removed.status).toBe(204);

        const listAfter = await auth(agent.get(`/api/v1/stores/${store.id}/expenses`));
        expect(listAfter.body.expenses).toHaveLength(0);
    });

    it('filters by date range and category', async () => {
        const { user, password } = await createUser({ planTier: PlanTier.STANDARD });
        const store = await createStoreWithOwner(user.id);
        const agent = createTestApp();
        const token = await login(agent, user.email, password);
        const auth = (req: any) => req.set('Authorization', `Bearer ${token}`);

        await auth(agent.post(`/api/v1/stores/${store.id}/expenses`).send({ date: '2026-06-01', amount: 100, category: 'Rent' }));
        await auth(agent.post(`/api/v1/stores/${store.id}/expenses`).send({ date: '2026-06-15', amount: 200, category: 'Utilities' }));
        await auth(agent.post(`/api/v1/stores/${store.id}/expenses`).send({ date: '2026-07-01', amount: 300, category: 'Rent' }));

        const byRange = await auth(agent.get(`/api/v1/stores/${store.id}/expenses?from=2026-06-01&to=2026-06-30`));
        expect(byRange.body.expenses).toHaveLength(2);

        const byCategory = await auth(agent.get(`/api/v1/stores/${store.id}/expenses?category=Rent`));
        expect(byCategory.body.expenses).toHaveLength(2);
        expect(byCategory.body.expenses.every((e: any) => e.category === 'Rent')).toBe(true);
    });

    it('defaults source to MANUAL and filters by source', async () => {
        const { user, password } = await createUser({ planTier: PlanTier.STANDARD });
        const store = await createStoreWithOwner(user.id);
        const agent = createTestApp();
        const token = await login(agent, user.email, password);
        const auth = (req: any) => req.set('Authorization', `Bearer ${token}`);

        const manual = await auth(
            agent.post(`/api/v1/stores/${store.id}/expenses`).send({ date: '2026-06-10', amount: 100, category: 'Utilities' })
        );
        expect(manual.status).toBe(201);
        expect(manual.body.expense.source).toBe('MANUAL');

        const fromDailySales = await auth(
            agent.post(`/api/v1/stores/${store.id}/expenses`).send({ date: '2026-06-10', amount: 50, category: 'Supplies', source: 'DAILY_SALES' })
        );
        expect(fromDailySales.status).toBe(201);
        expect(fromDailySales.body.expense.source).toBe('DAILY_SALES');

        const dsOnly = await auth(agent.get(`/api/v1/stores/${store.id}/expenses?source=DAILY_SALES`));
        expect(dsOnly.body.expenses).toHaveLength(1);
        expect(dsOnly.body.expenses[0].category).toBe('Supplies');

        const manualOnly = await auth(agent.get(`/api/v1/stores/${store.id}/expenses?source=MANUAL`));
        expect(manualOnly.body.expenses).toHaveLength(1);
        expect(manualOnly.body.expenses[0].category).toBe('Utilities');
    });

    it('blocks a STARTER plan owner via requirePlanFeature', async () => {
        const { user, password } = await createUser({ planTier: PlanTier.STARTER });
        const store = await createStoreWithOwner(user.id);
        const agent = createTestApp();
        const token = await login(agent, user.email, password);

        const res = await agent
            .get(`/api/v1/stores/${store.id}/expenses`)
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
        expect(res.body.error?.code).toBe('PLAN_LIMIT');
    });

    it('allows a VIEWER to read but not write', async () => {
        const { user: owner } = await createUser({ planTier: PlanTier.STANDARD });
        const store = await createStoreWithOwner(owner.id);
        const { user: viewer, password } = await createUser();
        await prisma.storeMember.create({ data: { storeId: store.id, userId: viewer.id, role: Role.VIEWER } });

        const agent = createTestApp();
        const token = await login(agent, viewer.email, password);
        const auth = (req: any) => req.set('Authorization', `Bearer ${token}`);

        const list = await auth(agent.get(`/api/v1/stores/${store.id}/expenses`));
        expect(list.status).toBe(200);

        const create = await auth(
            agent.post(`/api/v1/stores/${store.id}/expenses`).send({ date: '2026-06-10', amount: 50, category: 'Supplies' })
        );
        expect(create.status).toBe(403);
    });

    it('hides Rent/Salaries from non-privileged roles but shows them to owner/admin', async () => {
        const { user: owner, password: ownerPw } = await createUser({ planTier: PlanTier.STANDARD });
        const store = await createStoreWithOwner(owner.id);
        const { user: cashier, password: cashierPw } = await createUser();
        await prisma.storeMember.create({ data: { storeId: store.id, userId: cashier.id, role: Role.CASHIER } });

        const ownerAgent = createTestApp();
        const ownerToken = await login(ownerAgent, owner.email, ownerPw);
        const asOwner = (req: any) => req.set('Authorization', `Bearer ${ownerToken}`);

        await asOwner(ownerAgent.post(`/api/v1/stores/${store.id}/expenses`).send({ date: '2026-06-10', amount: 500, category: 'Rent' }));
        await asOwner(ownerAgent.post(`/api/v1/stores/${store.id}/expenses`).send({ date: '2026-06-10', amount: 80, category: 'Salaries' }));
        await asOwner(ownerAgent.post(`/api/v1/stores/${store.id}/expenses`).send({ date: '2026-06-10', amount: 30, category: 'Supplies' }));

        const ownerList = await asOwner(ownerAgent.get(`/api/v1/stores/${store.id}/expenses`));
        expect(ownerList.body.expenses).toHaveLength(3);

        const cashierAgent = createTestApp();
        const cashierToken = await login(cashierAgent, cashier.email, cashierPw);
        const asCashier = (req: any) => req.set('Authorization', `Bearer ${cashierToken}`);

        const cashierList = await asCashier(cashierAgent.get(`/api/v1/stores/${store.id}/expenses`));
        expect(cashierList.body.expenses).toHaveLength(1);
        expect(cashierList.body.expenses[0].category).toBe('Supplies');

        // Filtering by a restricted category returns nothing for the cashier.
        const cashierRent = await asCashier(cashierAgent.get(`/api/v1/stores/${store.id}/expenses?category=Rent`));
        expect(cashierRent.body.expenses).toHaveLength(0);
    });
});
