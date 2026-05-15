import { beforeEach, describe, expect, it } from 'vitest';
import { createProduct, createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

describe('sales finalize', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('finalizes a sale for a stocked product', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id, { allowNegativeStock: true });
        const product = await createProduct(store.id, { price: 25 });

        const agent = createTestApp();
        const loginRes = await agent.post('/api/v1/auth/login').send({
            email: user.email,
            password,
        });

        expect(loginRes.status).toBe(200);

        const finalizeRes = await agent
            .post(`/api/v1/stores/${store.id}/sales/finalize`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .send({
                paymentMethod: 'CASH',
                items: [
                    {
                        productId: product.id,
                        qty: 1,
                        unitPrice: 25,
                    },
                ],
            });

        expect(finalizeRes.status).toBe(201);
        expect(finalizeRes.body.sale?.status).toBe('FINALIZED');
        expect(finalizeRes.body.sale?.items?.length).toBe(1);
    });
});
