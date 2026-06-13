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

    it('ranks products by quantity sold for products-sold', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id, { timezone: 'UTC' });
        const productA = await createProduct(store.id, { name: 'Alpha', price: 10 });
        const productB = await createProduct(store.id, { name: 'Bravo', price: 5 });

        const ts = new Date('2025-03-10T08:00:00Z');
        const makeSale = (items: Array<{ id: string; name: string; qty: number; price: number }>) =>
            prisma.sale.create({
                data: {
                    storeId: store.id,
                    cashierId: user.id,
                    status: SaleStatus.FINALIZED,
                    subtotal: items.reduce((s, i) => s + i.qty * i.price, 0),
                    discount: 0,
                    tax: 0,
                    total: items.reduce((s, i) => s + i.qty * i.price, 0),
                    paymentMethod: PaymentMethod.CASH,
                    createdAt: ts,
                    finalizedAt: ts,
                    items: {
                        create: items.map((i) => ({
                            productId: i.id,
                            qty: i.qty,
                            unitPrice: i.price,
                            discount: 0,
                            tax: 0,
                            total: i.qty * i.price,
                            nameSnapshot: i.name,
                        })),
                    },
                },
            });

        // Alpha sold across two orders (qty 2 total), Bravo in one order (qty 1)
        await makeSale([
            { id: productA.id, name: 'Alpha', qty: 1, price: 10 },
            { id: productB.id, name: 'Bravo', qty: 1, price: 5 },
        ]);
        await makeSale([{ id: productA.id, name: 'Alpha', qty: 1, price: 10 }]);

        const agent = createTestApp();
        const loginRes = await agent.post('/api/v1/auth/login').send({ email: user.email, password });
        expect(loginRes.status).toBe(200);

        const res = await agent
            .get(`/api/v1/stores/${store.id}/reports/products-sold`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .query({ from: '2025-03-10', to: '2025-03-10' });

        expect(res.status).toBe(200);
        expect(res.body.summary?.totalQty).toBe(3);
        expect(res.body.summary?.productCount).toBe(2);
        expect(res.body.summary?.shown).toBe(2);
        expect(res.body.summary?.limited).toBe(false);
        expect(res.body.products?.[0]?.name).toBe('Alpha');
        expect(res.body.products?.[0]?.qtySold).toBe(2);
        expect(res.body.products?.[0]?.orderCount).toBe(2);
        expect(res.body.products?.[1]?.name).toBe('Bravo');
        expect(res.body.products?.[1]?.qtySold).toBe(1);
        expect(res.body.products?.[1]?.orderCount).toBe(1);
    });

    it('computes profit across all sold products, including uncosted ones', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id, { timezone: 'UTC' });
        // Costed product
        const costed = await prisma.product.create({
            data: { storeId: store.id, name: 'Costed', type: 'READY_MADE', price: 10, cost: 4, unit: 'pc' },
        });
        // Uncosted product (cost null)
        const uncosted = await prisma.product.create({
            data: { storeId: store.id, name: 'Uncosted', type: 'READY_MADE', price: 5, unit: 'pc' },
        });

        const ts = new Date('2025-04-01T08:00:00Z');
        await prisma.sale.create({
            data: {
                storeId: store.id,
                cashierId: user.id,
                status: SaleStatus.FINALIZED,
                subtotal: 25,
                discount: 0,
                tax: 0,
                total: 25,
                paymentMethod: PaymentMethod.CASH,
                createdAt: ts,
                finalizedAt: ts,
                items: {
                    create: [
                        { productId: costed.id, qty: 2, unitPrice: 10, discount: 0, tax: 0, total: 20, nameSnapshot: 'Costed' },
                        { productId: uncosted.id, qty: 1, unitPrice: 5, discount: 0, tax: 0, total: 5, nameSnapshot: 'Uncosted' },
                    ],
                },
            },
        });

        const agent = createTestApp();
        const loginRes = await agent.post('/api/v1/auth/login').send({ email: user.email, password });
        expect(loginRes.status).toBe(200);

        const res = await agent
            .get(`/api/v1/stores/${store.id}/reports/profit-summary`)
            .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
            .query({ from: '2025-04-01', to: '2025-04-01' });

        expect(res.status).toBe(200);
        // revenue 25, cost 2*4=8, profit 17, margin 68%
        expect(res.body.summary?.totalRevenue).toBe(25);
        expect(res.body.summary?.totalCost).toBe(8);
        expect(res.body.summary?.totalProfit).toBe(17);
        expect(res.body.summary?.marginPct).toBe(68);
        // both products counted, only one has a known cost
        expect(res.body.summary?.totalItems).toBe(2);
        expect(res.body.summary?.itemsWithCost).toBe(1);
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
