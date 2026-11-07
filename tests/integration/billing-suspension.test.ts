import { beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

const login = async (agent: ReturnType<typeof createTestApp>, email: string, password: string) => {
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

const adminLogin = async (agent: ReturnType<typeof createTestApp>) => {
    const { user, password } = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: true } });
    const res = await agent.post('/api/v1/auth/admin/login').send({ email: user.email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

// A month that has already ended, so a sent-and-unpaid bill for it is overdue.
const pastMonth = () => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 2);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
};

const sentLines = (storeId: string) => [
    { storeId, storeName: 'Test Store', storeType: 'RETAIL', position: 1, fee: 500 },
];

describe('billing suspension', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('makes the owner’s stores read-only for everyone and lifts it when the overdue bill is paid', async () => {
        const { user: owner, password: ownerPw } = await createUser();
        await prisma.user.update({ where: { id: owner.id }, data: { emailVerifiedAt: new Date() } });
        const store = await createStoreWithOwner(owner.id);
        const { user: cashier, password: cashierPw } = await createUser();
        await prisma.storeMember.create({ data: { storeId: store.id, userId: cashier.id, role: Role.INVENTORY_MANAGER } });

        const { year, month } = pastMonth();
        await prisma.billingStatement.create({
            data: { ownerId: owner.id, year, month, storeCount: 1, lines: sentLines(store.id), subtotal: 500, amount: 500, sentAt: new Date(), sendCount: 1 },
        });

        const ownerAgent = createTestApp();
        const ownerToken = await login(ownerAgent, owner.email, ownerPw);
        const asOwner = (req: any) => req.set('Authorization', `Bearer ${ownerToken}`);
        const staffAgent = createTestApp();
        const staffToken = await login(staffAgent, cashier.email, cashierPw);
        const asStaff = (req: any) => req.set('Authorization', `Bearer ${staffToken}`);
        const adminAgent = createTestApp();
        const adminToken = await adminLogin(adminAgent);
        const asAdmin = (req: any) => req.set('Authorization', `Bearer ${adminToken}`);

        // Overdue shows to the owner (for the banner), not to staff.
        const ownerStores = await asOwner(ownerAgent.get('/api/v1/stores'));
        expect(ownerStores.body.stores[0].billingOverdue).toEqual([{ year, month, amount: 500 }]);
        expect(ownerStores.body.stores[0].billingSuspended).toBe(false);
        const staffStores = await asStaff(staffAgent.get('/api/v1/stores'));
        expect(staffStores.body.stores[0].billingOverdue).toEqual([]);

        const billing = await asAdmin(adminAgent.get('/api/v1/admin/billing'));
        const row = billing.body.owners.find((o: any) => o.owner.id === owner.id);
        expect(row.overdueMonths).toHaveLength(1);

        const suspended = await asAdmin(
            adminAgent.patch(`/api/v1/admin/billing/owners/${owner.id}/suspension`).send({ suspended: true, reason: 'October unpaid' })
        );
        expect(suspended.status).toBe(200);
        expect(suspended.body.owner.suspension.reason).toBe('October unpaid');

        // Reads still work; writes are refused for owner and staff alike.
        expect((await asOwner(ownerAgent.get(`/api/v1/stores/${store.id}/suppliers`))).status).toBe(200);
        const ownerWrite = await asOwner(ownerAgent.post(`/api/v1/stores/${store.id}/suppliers`).send({ name: 'Acme' }));
        expect(ownerWrite.status).toBe(402);
        expect(ownerWrite.body.error?.code).toBe('BILLING_SUSPENDED');
        const staffWrite = await asStaff(staffAgent.post(`/api/v1/stores/${store.id}/suppliers`).send({ name: 'Acme' }));
        expect(staffWrite.status).toBe(402);
        const newStore = await asOwner(ownerAgent.post('/api/v1/stores').send({ name: 'Another' }));
        expect(newStore.status).toBe(402);

        const listed = await asStaff(staffAgent.get('/api/v1/stores'));
        expect(listed.body.stores[0].billingSuspended).toBe(true);

        // Paying the overdue month lifts the suspension.
        const paid = await asAdmin(
            adminAgent.patch(`/api/v1/admin/billing/${owner.id}/payment`).send({ year, month, paid: true })
        );
        expect(paid.status).toBe(200);
        expect(paid.body.reinstated).toBe(true);
        const afterPay = await asOwner(ownerAgent.post(`/api/v1/stores/${store.id}/suppliers`).send({ name: 'Acme' }));
        expect(afterPay.status).toBe(201);
    });

    it('stays suspended while another month is still overdue, and can be lifted manually', async () => {
        const { user: owner, password: ownerPw } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const { year, month } = pastMonth();
        const earlier = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
        for (const p of [{ year, month }, earlier]) {
            await prisma.billingStatement.create({
                data: { ownerId: owner.id, ...p, storeCount: 1, lines: sentLines(store.id), subtotal: 500, amount: 500, sentAt: new Date(), sendCount: 1 },
            });
        }

        const adminAgent = createTestApp();
        const adminToken = await adminLogin(adminAgent);
        const asAdmin = (req: any) => req.set('Authorization', `Bearer ${adminToken}`);
        await asAdmin(adminAgent.patch(`/api/v1/admin/billing/owners/${owner.id}/suspension`).send({ suspended: true }));

        const paid = await asAdmin(adminAgent.patch(`/api/v1/admin/billing/${owner.id}/payment`).send({ year, month, paid: true }));
        expect(paid.body.reinstated).toBe(false);

        const lifted = await asAdmin(
            adminAgent.patch(`/api/v1/admin/billing/owners/${owner.id}/suspension`).send({ suspended: false })
        );
        expect(lifted.body.owner.suspension).toBeNull();

        const agent = createTestApp();
        const token = await login(agent, owner.email, ownerPw);
        const write = await agent
            .post(`/api/v1/stores/${store.id}/suppliers`)
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Acme' });
        expect(write.status).toBe(201);
    });
});
