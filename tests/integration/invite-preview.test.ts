import crypto from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

// Mirrors the hashing used in storeMember.service.ts.
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

const createInvite = async (
    storeId: string,
    invitedById: string,
    overrides: { email?: string; role?: Role; expiresAt?: Date; acceptedAt?: Date | null } = {}
) => {
    const token = crypto.randomBytes(24).toString('hex');
    await prisma.storeInvite.create({
        data: {
            storeId,
            email: overrides.email ?? 'cashier@example.com',
            role: overrides.role ?? Role.CASHIER,
            tokenHash: hashToken(token),
            expiresAt: overrides.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
            acceptedAt: overrides.acceptedAt ?? null,
            invitedById,
        },
    });
    return token;
};

describe('store invite preview (public endpoint)', () => {
    beforeEach(async () => {
        await resetDb();
    });

    // Regression guard: `/invites/preview` must be reachable WITHOUT auth, since a
    // brand-new invitee has no session yet. A blanket auth middleware on the parent
    // `/stores` router previously shadowed this route and returned 401.
    it('returns invite details without an Authorization header', async () => {
        const { user: owner } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const token = await createInvite(store.id, owner.id, { email: 'cashier@example.com' });

        const agent = createTestApp();
        const res = await agent.get(`/api/v1/stores/${store.id}/invites/preview?token=${token}`);

        expect(res.status).toBe(200);
        expect(res.body.preview?.email).toBe('cashier@example.com');
        expect(res.body.preview?.role).toBe(Role.CASHIER);
    });

    it('returns 404 for an unknown token (still without auth)', async () => {
        const { user: owner } = await createUser();
        const store = await createStoreWithOwner(owner.id);

        const agent = createTestApp();
        const res = await agent.get(
            `/api/v1/stores/${store.id}/invites/preview?token=${crypto.randomBytes(24).toString('hex')}`
        );

        expect(res.status).toBe(404);
    });

    it('returns 410 for an expired invite', async () => {
        const { user: owner } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const token = await createInvite(store.id, owner.id, {
            expiresAt: new Date(Date.now() - 60 * 1000),
        });

        const agent = createTestApp();
        const res = await agent.get(`/api/v1/stores/${store.id}/invites/preview?token=${token}`);

        expect(res.status).toBe(410);
    });
});
