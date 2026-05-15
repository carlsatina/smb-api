import { beforeEach, describe, expect, it } from 'vitest';
import { createProduct, createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

describe('inventory adjustments', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('creates stock adjustments for products', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id);
        const product = await createProduct(store.id);

        const agent = createTestApp();
        const loginRes = await agent.post('/api/v1/auth/login').send({
            email: user.email,
            password,
        });

        expect(loginRes.status).toBe(200);

        const adjustmentRes = await agent
            .post(`/api/v1/stores/${store.id}/inventory/adjustments`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .send({
                itemType: 'PRODUCT',
                itemId: product.id,
                qtyDelta: 5,
                note: 'Initial stock',
            });

        expect(adjustmentRes.status).toBe(201);
        expect(adjustmentRes.body.movement?.qtyDelta).toBe(5);

        const stockRes = await agent
            .get(`/api/v1/stores/${store.id}/inventory/stock`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .query({ itemType: 'PRODUCT', itemId: product.id });

        expect(stockRes.status).toBe(200);
        expect(stockRes.body.stock?.length).toBe(1);
    });

    it('blocks negative adjustments when disabled', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id, { allowNegativeStock: false });
        const product = await createProduct(store.id);

        const agent = createTestApp();
        const loginRes = await agent.post('/api/v1/auth/login').send({
            email: user.email,
            password,
        });

        expect(loginRes.status).toBe(200);

        const adjustmentRes = await agent
            .post(`/api/v1/stores/${store.id}/inventory/adjustments`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .send({
                itemType: 'PRODUCT',
                itemId: product.id,
                qtyDelta: -1,
                note: 'Negative test',
            });

        expect(adjustmentRes.status).toBe(400);
        expect(adjustmentRes.body.error?.code).toBe('NEGATIVE_STOCK');
    });
});
