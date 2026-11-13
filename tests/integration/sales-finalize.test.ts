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

    it('treats tax as VAT already included in the price, not added on top', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id, { allowNegativeStock: true });
        const product = await createProduct(store.id, { price: 112 });

        const agent = createTestApp();
        const loginRes = await agent.post('/api/v1/auth/login').send({ email: user.email, password });
        expect(loginRes.status).toBe(200);

        // 2 × 112 = 224 holds 24 VAT at 12% (224 × 12 / 112).
        const res = await agent
            .post(`/api/v1/stores/${store.id}/sales/finalize`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .send({
                paymentMethod: 'CASH',
                items: [{ productId: product.id, qty: 2, unitPrice: 112, tax: 24 }],
            });

        expect(res.status).toBe(201);
        expect(res.body.sale).toMatchObject({ subtotal: 224, tax: 24, total: 224 });
        expect(res.body.sale.items[0].total).toBe(224);

        const tooMuchTax = await agent
            .post(`/api/v1/stores/${store.id}/sales/finalize`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .send({
                paymentMethod: 'CASH',
                items: [{ productId: product.id, qty: 1, unitPrice: 112, tax: 200 }],
            });
        expect(tooMuchTax.status).toBe(400);
        expect(tooMuchTax.body.error?.code).toBe('INVALID_TAX');
    });
});
