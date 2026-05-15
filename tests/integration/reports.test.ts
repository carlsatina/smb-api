import { beforeEach, describe, expect, it } from 'vitest';
import { PaymentMethod, PurchaseOrderStatus, SaleStatus } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
    createProduct,
    createStoreWithOwner,
    createSupplier,
    createTestApp,
    createUser,
    resetDb,
} from './helpers';

describe('reports', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('uses store timezone for sales-by-day', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id, { timezone: 'America/Los_Angeles' });
        const product = await createProduct(store.id, { price: 10 });

        const saleTimestamp = new Date('2025-01-02T07:30:00Z');

        await prisma.sale.create({
            data: {
                storeId: store.id,
                cashierId: user.id,
                status: SaleStatus.FINALIZED,
                subtotal: 10,
                discount: 0,
                tax: 0,
                total: 10,
                paymentMethod: PaymentMethod.CASH,
                createdAt: saleTimestamp,
                finalizedAt: saleTimestamp,
                items: {
                    create: [
                        {
                            productId: product.id,
                            qty: 1,
                            unitPrice: 10,
                            discount: 0,
                            tax: 0,
                            total: 10,
                            nameSnapshot: product.name,
                        },
                    ],
                },
            },
        });

        const agent = createTestApp();
        const loginRes = await agent.post('/api/v1/auth/login').send({
            email: user.email,
            password,
        });

        expect(loginRes.status).toBe(200);

        const reportRes = await agent
            .get(`/api/v1/stores/${store.id}/reports/sales-by-day`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .query({ from: '2025-01-01', to: '2025-01-01' });

        expect(reportRes.status).toBe(200);
        expect(reportRes.body.range?.from).toBe('2025-01-01');
        expect(reportRes.body.range?.to).toBe('2025-01-01');
        expect(reportRes.body.totals?.totalSales).toBe(10);
        expect(reportRes.body.totals?.orderCount).toBe(1);
        expect(reportRes.body.days?.length).toBe(1);
        expect(reportRes.body.days?.[0]?.date).toBe('2025-01-01');
        expect(reportRes.body.days?.[0]?.totalSales).toBe(10);
        expect(reportRes.body.days?.[0]?.orderCount).toBe(1);
    });

    it('filters purchase spend by store timezone', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id, { timezone: 'America/Los_Angeles' });
        const supplier = await createSupplier(store.id, 'West Supplies');

        const purchaseOrder = await prisma.purchaseOrder.create({
            data: {
                storeId: store.id,
                supplierId: supplier.id,
                status: PurchaseOrderStatus.RECEIVED,
            },
        });

        const receiptTimestamp = new Date('2025-02-01T07:30:00Z');

        await prisma.purchaseReceipt.create({
            data: {
                storeId: store.id,
                purchaseOrderId: purchaseOrder.id,
                invoiceNumber: 'INV-1',
                receivedById: user.id,
                receivedAt: receiptTimestamp,
                totalCost: 50,
            },
        });

        const agent = createTestApp();
        const loginRes = await agent.post('/api/v1/auth/login').send({
            email: user.email,
            password,
        });

        expect(loginRes.status).toBe(200);

        const reportRes = await agent
            .get(`/api/v1/stores/${store.id}/reports/purchase-spend`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .query({ from: '2025-01-31', to: '2025-01-31' });

        expect(reportRes.status).toBe(200);
        expect(reportRes.body.summary?.totalSpend).toBe(50);
        expect(reportRes.body.summary?.totalReceipts).toBe(1);
        expect(reportRes.body.suppliers?.[0]?.supplierName).toBe('West Supplies');
        expect(reportRes.body.suppliers?.[0]?.receiptCount).toBe(1);
    });
});
