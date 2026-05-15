import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../lib/prisma';
import {
    createProduct,
    createStoreWithOwner,
    createTestApp,
    createUser,
    resetDb,
} from './helpers';
import { Role } from '@prisma/client';

describe('role access', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('blocks cashier from inventory adjustments and product creation', async () => {
        const { user: owner } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        const product = await createProduct(store.id);
        const { user: cashier, password: cashierPassword } = await createUser();

        await prisma.storeMember.create({
            data: {
                storeId: store.id,
                userId: cashier.id,
                role: Role.CASHIER,
            },
        });

        const agent = createTestApp();
        const loginRes = await agent.post('/api/v1/auth/login').send({
            email: cashier.email,
            password: cashierPassword,
        });

        expect(loginRes.status).toBe(200);

        const productRes = await agent
            .post(`/api/v1/stores/${store.id}/products`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .send({
                name: 'Cashier Product',
                type: 'READY_MADE',
                price: 10,
                unit: 'pc',
            });

        expect(productRes.status).toBe(403);
        expect(productRes.body.error?.code).toBe('FORBIDDEN');

        const adjustmentRes = await agent
            .post(`/api/v1/stores/${store.id}/inventory/adjustments`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .send({
                itemType: 'PRODUCT',
                itemId: product.id,
                qtyDelta: 2,
            });

        expect(adjustmentRes.status).toBe(403);
        expect(adjustmentRes.body.error?.code).toBe('FORBIDDEN');

        const purchaseOrderRes = await agent
            .post(`/api/v1/stores/${store.id}/purchase-orders`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .send({
                supplierId: 'placeholder',
                items: [],
            });

        expect(purchaseOrderRes.status).toBe(403);
        expect(purchaseOrderRes.body.error?.code).toBe('FORBIDDEN');
    });
});
