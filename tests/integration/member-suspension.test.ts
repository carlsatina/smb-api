import { beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

// Suspension is access revoked without removal: the membership row stays, so
// everything pointing at it (sales, attendance, payroll) survives, and the
// member is refused at the one gate every store route passes through.

const login = async (agent: ReturnType<typeof createTestApp>, email: string, password: string) => {
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

const addMember = (storeId: string, userId: string, role: Role) =>
    prisma.storeMember.create({ data: { storeId, userId, role } });

describe('member suspension', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('locks a suspended member out of the store and lets them back in on reinstate', async () => {
        const { user: owner, password: ownerPassword } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const { user: cashier, password: cashierPassword } = await createUser();
        const member = await addMember(store.id, cashier.id, Role.CASHIER);

        const agent = createTestApp();
        const ownerToken = await login(agent, owner.email, ownerPassword);
        const cashierToken = await login(agent, cashier.email, cashierPassword);

        // Reachable before suspension.
        const before = await agent
            .get(`/api/v1/stores/${store.id}/products`)
            .set('Authorization', `Bearer ${cashierToken}`);
        expect(before.status).toBe(200);

        const suspendRes = await agent
            .patch(`/api/v1/stores/${store.id}/members/${member.id}/suspension`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ suspended: true });
        expect(suspendRes.status).toBe(200);
        expect(suspendRes.body.members.find((m: any) => m.id === member.id).suspendedAt).toBeTruthy();

        // The existing access token is still valid — suspension is checked per
        // request, so it takes effect without waiting for the token to expire.
        const during = await agent
            .get(`/api/v1/stores/${store.id}/products`)
            .set('Authorization', `Bearer ${cashierToken}`);
        expect(during.status).toBe(403);
        expect(during.body.error?.code).toBe('MEMBER_SUSPENDED');

        const reinstateRes = await agent
            .patch(`/api/v1/stores/${store.id}/members/${member.id}/suspension`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ suspended: false });
        expect(reinstateRes.status).toBe(200);

        const after = await agent
            .get(`/api/v1/stores/${store.id}/products`)
            .set('Authorization', `Bearer ${cashierToken}`);
        expect(after.status).toBe(200);
    });

    it('hides the store from the suspended member’s own store list', async () => {
        const { user: owner, password: ownerPassword } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const { user: staff, password: staffPassword } = await createUser();
        const member = await addMember(store.id, staff.id, Role.VIEWER);

        const agent = createTestApp();
        const ownerToken = await login(agent, owner.email, ownerPassword);
        const staffToken = await login(agent, staff.email, staffPassword);

        const listed = await agent.get('/api/v1/stores').set('Authorization', `Bearer ${staffToken}`);
        expect(listed.body.stores).toHaveLength(1);

        await agent
            .patch(`/api/v1/stores/${store.id}/members/${member.id}/suspension`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ suspended: true });

        const relisted = await agent.get('/api/v1/stores').set('Authorization', `Bearer ${staffToken}`);
        expect(relisted.body.stores).toHaveLength(0);
    });

    it('keeps the membership row, and logs who suspended them', async () => {
        const { user: owner, password: ownerPassword } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const { user: staff } = await createUser();
        const member = await addMember(store.id, staff.id, Role.CASHIER);

        const agent = createTestApp();
        const ownerToken = await login(agent, owner.email, ownerPassword);

        await agent
            .patch(`/api/v1/stores/${store.id}/members/${member.id}/suspension`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ suspended: true });

        const row = await prisma.storeMember.findUnique({ where: { id: member.id } });
        expect(row?.deletedAt).toBeNull();
        expect(row?.role).toBe(Role.CASHIER);
        expect(row?.suspendedAt).toBeTruthy();

        // The column carries the access decision; the log carries the story.
        const entry = await prisma.auditLog.findFirst({
            where: { storeId: store.id, entityType: 'StoreMember', entityId: member.id },
            orderBy: { createdAt: 'desc' },
        });
        expect(entry?.action).toBe('MEMBER_SUSPENDED');
        expect(entry?.actorId).toBe(owner.id);

        // ...and the list surfaces it as the "suspended by" line.
        const listed = await agent
            .get(`/api/v1/stores/${store.id}/members`)
            .set('Authorization', `Bearer ${ownerToken}`);
        expect(listed.body.members.find((m: any) => m.id === member.id).suspendedBy).toBe(
            owner.fullName
        );
    });

    it('stays suspended even if the audit log is purged', async () => {
        const { user: owner, password: ownerPassword } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const { user: staff, password: staffPassword } = await createUser();
        const member = await addMember(store.id, staff.id, Role.CASHIER);

        const agent = createTestApp();
        const ownerToken = await login(agent, owner.email, ownerPassword);
        const staffToken = await login(agent, staff.email, staffPassword);

        await agent
            .patch(`/api/v1/stores/${store.id}/members/${member.id}/suspension`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ suspended: true });

        // The reason the access decision does not live in the log.
        await prisma.auditLog.deleteMany({ where: { storeId: store.id } });

        const res = await agent
            .get(`/api/v1/stores/${store.id}/products`)
            .set('Authorization', `Bearer ${staffToken}`);
        expect(res.status).toBe(403);
        expect(res.body.error?.code).toBe('MEMBER_SUSPENDED');

        // Only the attribution is lost.
        const listed = await agent
            .get(`/api/v1/stores/${store.id}/members`)
            .set('Authorization', `Bearer ${ownerToken}`);
        const row = listed.body.members.find((m: any) => m.id === member.id);
        expect(row.suspendedAt).toBeTruthy();
        expect(row.suspendedBy).toBeNull();
    });

    it('refuses to suspend your own membership', async () => {
        const { user: owner, password: ownerPassword } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const self = await prisma.storeMember.findFirstOrThrow({
            where: { storeId: store.id, userId: owner.id },
        });

        const agent = createTestApp();
        const ownerToken = await login(agent, owner.email, ownerPassword);

        const res = await agent
            .patch(`/api/v1/stores/${store.id}/members/${self.id}/suspension`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ suspended: true });

        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe('SELF_SUSPEND');
    });

    it('refuses to suspend the last active owner', async () => {
        const { user: owner } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const { user: secondOwner, password: secondOwnerPassword } = await createUser();
        const ownerMember = await prisma.storeMember.findFirstOrThrow({
            where: { storeId: store.id, userId: owner.id },
        });
        await addMember(store.id, secondOwner.id, Role.OWNER);

        const agent = createTestApp();
        const secondToken = await login(agent, secondOwner.email, secondOwnerPassword);

        // Two owners, so suspending one is allowed.
        const first = await agent
            .patch(`/api/v1/stores/${store.id}/members/${ownerMember.id}/suspension`)
            .set('Authorization', `Bearer ${secondToken}`)
            .send({ suspended: true });
        expect(first.status).toBe(200);

        // The suspended owner no longer counts as the one left standing, so the
        // remaining owner cannot be suspended by an admin either.
        const { user: admin, password: adminPassword } = await createUser();
        await addMember(store.id, admin.id, Role.ADMIN);
        const adminToken = await login(agent, admin.email, adminPassword);
        const secondOwnerMember = await prisma.storeMember.findFirstOrThrow({
            where: { storeId: store.id, userId: secondOwner.id },
        });

        const second = await agent
            .patch(`/api/v1/stores/${store.id}/members/${secondOwnerMember.id}/suspension`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ suspended: true });
        expect(second.status).toBe(403);
        expect(second.body.error?.code).toBe('FORBIDDEN');
    });

    it('is idempotent — suspending twice keeps the original timestamp', async () => {
        const { user: owner, password: ownerPassword } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const { user: staff } = await createUser();
        const member = await addMember(store.id, staff.id, Role.CASHIER);

        const agent = createTestApp();
        const ownerToken = await login(agent, owner.email, ownerPassword);
        const suspend = () =>
            agent
                .patch(`/api/v1/stores/${store.id}/members/${member.id}/suspension`)
                .set('Authorization', `Bearer ${ownerToken}`)
                .send({ suspended: true });

        await suspend();
        const first = await prisma.storeMember.findUnique({ where: { id: member.id } });
        await suspend();
        const second = await prisma.storeMember.findUnique({ where: { id: member.id } });

        expect(second?.suspendedAt?.toISOString()).toBe(first?.suspendedAt?.toISOString());
    });

    it('will not re-invite around a suspension', async () => {
        const { user: owner, password: ownerPassword } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const { user: staff } = await createUser();
        const member = await addMember(store.id, staff.id, Role.CASHIER);

        const agent = createTestApp();
        const ownerToken = await login(agent, owner.email, ownerPassword);

        await agent
            .patch(`/api/v1/stores/${store.id}/members/${member.id}/suspension`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ suspended: true });

        const res = await agent
            .post(`/api/v1/stores/${store.id}/invites`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ email: staff.email, role: Role.CASHIER });

        expect(res.status).toBe(409);
        expect(res.body.error?.code).toBe('ALREADY_MEMBER');
        expect(res.body.error?.message).toContain('suspended');
    });

    it('frees the suspended member’s plan seat for someone else', async () => {
        const { user: owner, password: ownerPassword } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const plan = (await import('../../src/config/plans')).getPlanConfig(owner.planTier);

        // Fill the store to its plan limit — the owner already holds one seat.
        const filler: string[] = [];
        for (let i = 0; i < plan.maxUsersPerStore - 1; i += 1) {
            const { user } = await createUser();
            const created = await addMember(store.id, user.id, Role.CASHIER);
            filler.push(created.id);
        }

        const agent = createTestApp();
        const ownerToken = await login(agent, owner.email, ownerPassword);
        const invite = (email: string) =>
            agent
                .post(`/api/v1/stores/${store.id}/invites`)
                .set('Authorization', `Bearer ${ownerToken}`)
                .send({ email, role: Role.CASHIER });

        const full = await invite('over-the-limit@example.com');
        expect(full.status).toBe(403);
        expect(full.body.error?.code).toBe('PLAN_LIMIT');

        await agent
            .patch(`/api/v1/stores/${store.id}/members/${filler[0]}/suspension`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ suspended: true });

        const withSeat = await invite('now-there-is-room@example.com');
        expect(withSeat.status).toBe(201);
    });
});
