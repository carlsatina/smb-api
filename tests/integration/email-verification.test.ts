import crypto from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../lib/prisma';
import { createTestApp, createUser, resetDb } from './helpers';

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

describe('email verification', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('verifies email with a valid token', async () => {
        const { user } = await createUser();
        const token = crypto.randomBytes(16).toString('hex');

        await prisma.emailVerificationToken.create({
            data: {
                userId: user.id,
                tokenHash: hashToken(token),
                expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            },
        });

        const agent = createTestApp();
        const verifyRes = await agent.post('/api/v1/auth/verify').send({ token });

        expect(verifyRes.status).toBe(200);
        expect(verifyRes.body.ok).toBe(true);

        const updated = await prisma.user.findUnique({ where: { id: user.id } });
        expect(updated?.emailVerifiedAt).toBeTruthy();
    });

    it('rejects an expired token', async () => {
        const { user } = await createUser();
        const token = crypto.randomBytes(16).toString('hex');

        await prisma.emailVerificationToken.create({
            data: {
                userId: user.id,
                tokenHash: hashToken(token),
                expiresAt: new Date(Date.now() - 5 * 60 * 1000),
            },
        });

        const agent = createTestApp();
        const verifyRes = await agent.post('/api/v1/auth/verify').send({ token });

        expect(verifyRes.status).toBe(400);
        expect(verifyRes.body.error?.code).toBe('INVALID_VERIFY');
    });
});
