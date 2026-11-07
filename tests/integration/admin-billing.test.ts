import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../../lib/prisma';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

vi.mock('../../src/shared/email', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/shared/email')>();
    return { ...actual, sendBillingEmail: vi.fn(async () => ({ sent: true })) };
});

const adminLogin = async (agent: ReturnType<typeof createTestApp>) => {
    const { user, password } = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: true } });
    const res = await agent.post('/api/v1/auth/admin/login').send({ email: user.email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

describe('admin per-store billing', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('prices an owner’s stores oldest first, then snapshots on send and freezes on payment', async () => {
        const { user: owner } = await createUser();
        const first = await createStoreWithOwner(owner.id, { name: 'First' });
        const second = await createStoreWithOwner(owner.id, { name: 'Second' });
        const third = await createStoreWithOwner(owner.id, { name: 'Third' });
        const base = new Date();
        base.setUTCDate(1);
        await prisma.store.update({ where: { id: first.id }, data: { createdAt: new Date(base.getTime() - 3 * 86400000) } });
        await prisma.store.update({ where: { id: second.id }, data: { createdAt: new Date(base.getTime() - 2 * 86400000) } });
        await prisma.store.update({ where: { id: third.id }, data: { createdAt: new Date(base.getTime() - 1 * 86400000) } });

        const agent = createTestApp();
        const token = await adminLogin(agent);
        const auth = (req: any) => req.set('Authorization', `Bearer ${token}`);

        const list = await auth(agent.get('/api/v1/admin/billing'));
        expect(list.status).toBe(200);
        const row = list.body.owners.find((o: any) => o.owner.id === owner.id);
        expect(row.lines.map((l: any) => [l.storeName, l.fee])).toEqual([
            ['First', 500],
            ['Second', 400],
            ['Third', 300],
        ]);
        expect(row.amount).toBe(1200);
        expect(row.statement).toBeNull();

        const { month, year } = list.body;
        const sent = await auth(agent.post(`/api/v1/admin/billing/${owner.id}/send`).send({ month, year }));
        expect(sent.status).toBe(200);
        expect(sent.body.sent).toBe(true);
        expect(sent.body.statement.amount).toBe(1200);
        expect(sent.body.statement.sendCount).toBe(1);

        const paid = await auth(
            agent.patch(`/api/v1/admin/billing/${owner.id}/payment`).send({ month, year, paid: true, note: 'GCash ref 123' })
        );
        expect(paid.status).toBe(200);
        expect(paid.body.statement.paidAt).toBeTruthy();
        expect(paid.body.statement.paymentNote).toBe('GCash ref 123');

        // Adding a store after payment doesn't change what was billed.
        await createStoreWithOwner(owner.id, { name: 'Fourth' });
        const resent = await auth(agent.post(`/api/v1/admin/billing/${owner.id}/send`).send({ month, year }));
        expect(resent.body.statement.amount).toBe(1200);
        expect(resent.body.statement.sendCount).toBe(2);

        const unpaid = await auth(
            agent.patch(`/api/v1/admin/billing/${owner.id}/payment`).send({ month, year, paid: false })
        );
        expect(unpaid.body.statement.paidAt).toBeNull();

        const history = await auth(agent.get(`/api/v1/admin/billing/history?month=${month}&year=${year}`));
        expect(history.body.entries).toHaveLength(1);
        expect(history.body.entries[0].ownerEmail).toBe(owner.email);
    });

    it('refuses to bill an owner with no stores', async () => {
        const { user: owner } = await createUser();
        const agent = createTestApp();
        const token = await adminLogin(agent);
        const res = await agent
            .post(`/api/v1/admin/billing/${owner.id}/send`)
            .set('Authorization', `Bearer ${token}`)
            .send({ month: 1, year: 2026 });
        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe('NOTHING_TO_BILL');
    });

    it('lets an owner create more stores without a plan limit', async () => {
        const { user, password } = await createUser();
        await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
        const agent = createTestApp();
        const login = await agent.post('/api/v1/auth/login').send({ email: user.email, password });
        const token = login.body.accessToken as string;
        for (const name of ['A', 'B', 'C']) {
            const res = await agent
                .post('/api/v1/stores')
                .set('Authorization', `Bearer ${token}`)
                .send({ name });
            expect(res.status).toBe(201);
        }
    });

    it('applies owner discounts and free stores, and refuses a fully-free month', async () => {
        const { user: owner } = await createUser();
        const first = await createStoreWithOwner(owner.id, { name: 'First' });
        const second = await createStoreWithOwner(owner.id, { name: 'Second' });
        await prisma.store.update({ where: { id: first.id }, data: { createdAt: new Date(Date.now() - 10 * 86400000) } });

        const agent = createTestApp();
        const token = await adminLogin(agent);
        const auth = (req: any) => req.set('Authorization', `Bearer ${token}`);
        const rowFor = async () => {
            const list = await auth(agent.get('/api/v1/admin/billing'));
            return { body: list.body, row: list.body.owners.find((o: any) => o.owner.id === owner.id) };
        };

        // Free the oldest store: the second store takes the 500 slot.
        const exempt = await auth(
            agent.patch(`/api/v1/admin/billing/stores/${first.id}/exemption`).send({ exempt: true, note: 'Pilot' })
        );
        expect(exempt.status).toBe(200);
        expect(exempt.body.store.billingExempt).toBe(true);
        let { row, body } = await rowFor();
        expect(row.lines.map((l: any) => [l.storeName, l.position, l.fee])).toEqual([
            ['Second', 1, 500],
            ['First', null, 0],
        ]);
        expect(row.amount).toBe(500);

        // 20% off on top.
        const discount = await auth(
            agent.patch(`/api/v1/admin/billing/owners/${owner.id}/discount`).send({
                discount: { type: 'PERCENT', value: 20, note: 'Friend' },
            })
        );
        expect(discount.status).toBe(200);
        expect(discount.body.owner.discount).toMatchObject({ type: 'PERCENT', value: 20, note: 'Friend' });
        ({ row, body } = await rowFor());
        expect(row).toMatchObject({ subtotal: 500, discountAmount: 100, amount: 400 });

        const sent = await auth(
            agent.post(`/api/v1/admin/billing/${owner.id}/send`).send({ month: body.month, year: body.year })
        );
        expect(sent.body.statement).toMatchObject({ subtotal: 500, discountAmount: 100, amount: 400 });
        expect(sent.body.statement.discountNote).toBe('20% off (Friend)');

        // A discount that ended last month no longer applies.
        const lastMonth = body.month === 1 ? { y: body.year - 1, m: 12 } : { y: body.year, m: body.month - 1 };
        await auth(
            agent.patch(`/api/v1/admin/billing/owners/${owner.id}/discount`).send({
                discount: { type: 'FIXED', value: 100, throughYear: lastMonth.y, throughMonth: lastMonth.m },
            })
        );
        ({ row } = await rowFor());
        expect(row.discountAmount).toBe(0);

        // Both stores free: nothing to bill.
        await auth(agent.patch(`/api/v1/admin/billing/stores/${second.id}/exemption`).send({ exempt: true }));
        ({ row } = await rowFor());
        expect(row.amount).toBe(0);
        // Re-sending re-prices from current settings, and a ₱0 month isn't billed.
        const refused = await auth(
            agent.post(`/api/v1/admin/billing/${owner.id}/send`).send({ month: body.month, year: body.year })
        );
        expect(refused.status).toBe(400);
        expect(refused.body.error?.code).toBe('NOTHING_TO_BILL');

        // Recording payment for the bill already sent keeps the amount that was sent.
        const paid = await auth(
            agent.patch(`/api/v1/admin/billing/${owner.id}/payment`).send({ month: body.month, year: body.year, paid: true })
        );
        expect(paid.body.statement.amount).toBe(400);

        // Clearing works.
        const cleared = await auth(agent.patch(`/api/v1/admin/billing/owners/${owner.id}/discount`).send({ discount: null }));
        expect(cleared.body.owner.discount).toBeNull();
        const unexempt = await auth(agent.patch(`/api/v1/admin/billing/stores/${second.id}/exemption`).send({ exempt: false }));
        expect(unexempt.body.store).toMatchObject({ billingExempt: false, billingExemptNote: null });
    });

    it('rejects a percent discount above 100', async () => {
        const { user: owner } = await createUser();
        const agent = createTestApp();
        const token = await adminLogin(agent);
        const res = await agent
            .patch(`/api/v1/admin/billing/owners/${owner.id}/discount`)
            .set('Authorization', `Bearer ${token}`)
            .send({ discount: { type: 'PERCENT', value: 120 } });
        expect(res.status).toBe(400);
    });
});
