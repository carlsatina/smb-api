import { beforeEach, describe, expect, it } from 'vitest';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

describe('store access scoping', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('blocks access to stores without membership', async () => {
        const { user: userA, password: passwordA } = await createUser();
        const { user: userB } = await createUser();

        const storeA = await createStoreWithOwner(userA.id);
        const storeB = await createStoreWithOwner(userB.id);

        const agent = createTestApp();
        const loginRes = await agent.post('/api/v1/auth/login').send({
            email: userA.email,
            password: passwordA,
        });

        expect(loginRes.status).toBe(200);

        const stockRes = await agent
            .get(`/api/v1/stores/${storeB.id}/inventory/stock`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`);

        expect(stockRes.status).toBe(403);
        expect(stockRes.body.error?.code).toBe('FORBIDDEN');
    });
});
