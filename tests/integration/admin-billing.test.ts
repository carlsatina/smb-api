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
});
