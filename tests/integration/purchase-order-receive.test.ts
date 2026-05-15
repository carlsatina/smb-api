import { beforeEach, describe, expect, it } from 'vitest';
import {
    createProduct,
    createStoreWithOwner,
    createSupplier,
    createTestApp,
    createUser,
    resetDb,
} from './helpers';

describe('purchase order receiving', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('receives a purchase order and updates status', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id);
        const supplier = await createSupplier(store.id);
        const product = await createProduct(store.id);

        const agent = createTestApp();
        const loginRes = await agent.post('/api/v1/auth/login').send({
            email: user.email,
            password,
        });

        expect(loginRes.status).toBe(200);

        const createRes = await agent
            .post(`/api/v1/stores/${store.id}/purchase-orders`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .send({
                supplierId: supplier.id,
                items: [
                    {
                        itemType: 'PRODUCT',
                        itemId: product.id,
                        qtyOrdered: 5,
                        unitCost: 3,
                    },
                ],
            });

        expect(createRes.status).toBe(201);
        const purchaseOrderId = createRes.body.purchaseOrder?.id;
        expect(purchaseOrderId).toBeTruthy();

        const receiveRes = await agent
            .post(`/api/v1/stores/${store.id}/purchase-orders/${purchaseOrderId}/receive`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .send({
                invoiceNumber: 'INV-100',
                items: [
                    {
                        itemType: 'PRODUCT',
                        itemId: product.id,
                        qtyReceived: 5,
                        unitCost: 3,
                    },
                ],
            });

        expect(receiveRes.status).toBe(201);
        expect(receiveRes.body.receiptId).toBeTruthy();
        expect(receiveRes.body.purchaseOrder?.status).toBe('RECEIVED');
    });
});
