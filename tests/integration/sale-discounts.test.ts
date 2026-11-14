import { Role } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../lib/prisma';
import { createProduct, createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

const login = async (email: string, password: string) => {
    const agent = createTestApp();
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return { agent, auth: `Bearer ${res.body.accessToken}` };
};

const setup = async () => {
    const { user: owner, password } = await createUser();
    const store = await createStoreWithOwner(owner.id, { allowNegativeStock: true });
    await prisma.store.update({ where: { id: store.id }, data: { defaultTaxRate: 12 } });

    const { user: cashier, password: cashierPassword } = await createUser();
    await prisma.storeMember.create({ data: { storeId: store.id, userId: cashier.id, role: Role.CASHIER } });

    const ownerSession = await login(owner.email, password);
    const cashierSession = await login(cashier.email, cashierPassword);
    const base = `/api/v1/stores/${store.id}`;

    const types = await ownerSession.agent.get(`${base}/discount-types`).set('Authorization', ownerSession.auth);
    expect(types.status).toBe(200);
    const sc = types.body.discountTypes.find((t: { code: string }) => t.code === 'SC');

    return { store, owner: ownerSession, cashier: cashierSession, base, sc };
};

describe('discount types', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('creates the Senior and PWD presets with their legal settings locked', async () => {
        const { owner, base, sc } = await setup();

        const list = await owner.agent.get(`${base}/discount-types`).set('Authorization', owner.auth);
        expect(list.body.discountTypes.map((t: { code: string }) => t.code)).toEqual(['SC', 'PWD']);
        expect(sc).toMatchObject({
            statutory: true,
            method: 'PERCENT',
            value: 20,
            removesVat: true,
            holderName: 'REQUIRED',
            holderIdNumber: 'REQUIRED',
            lockedFields: ['code', 'method', 'value', 'removesVat'],
        });

        const lowerRate = await owner.agent
            .patch(`${base}/discount-types/${sc.id}`)
            .set('Authorization', owner.auth)
            .send({ value: 10 });
        expect(lowerRate.status).toBe(400);
        expect(lowerRate.body.error.code).toBe('STATUTORY_DISCOUNT_LOCKED');

        const relaxId = await owner.agent
            .patch(`${base}/discount-types/${sc.id}`)
            .set('Authorization', owner.auth)
            .send({ holderIdNumber: 'OPTIONAL', scope: 'LINE', value: 20 });
        expect(relaxId.status).toBe(200);
        expect(relaxId.body.discountType).toMatchObject({ holderIdNumber: 'OPTIONAL', scope: 'LINE' });

        const remove = await owner.agent.delete(`${base}/discount-types/${sc.id}`).set('Authorization', owner.auth);
        expect(remove.status).toBe(400);
    });

    it('lets managers add, rename and archive their own discounts', async () => {
        const { owner, cashier, base } = await setup();
        const body = { name: 'Employee meal', code: 'emp', method: 'PERCENT', value: 10, scope: 'BOTH' };

        const denied = await cashier.agent.post(`${base}/discount-types`).set('Authorization', cashier.auth).send(body);
        expect(denied.status).toBe(403);

        const created = await owner.agent.post(`${base}/discount-types`).set('Authorization', owner.auth).send(body);
        expect(created.status).toBe(201);
        expect(created.body.discountType).toMatchObject({ code: 'EMP', statutory: false, holderName: 'OFF' });

        const duplicate = await owner.agent.post(`${base}/discount-types`).set('Authorization', owner.auth).send(body);
        expect(duplicate.status).toBe(409);

        const tooMuch = await owner.agent
            .patch(`${base}/discount-types/${created.body.discountType.id}`)
            .set('Authorization', owner.auth)
            .send({ value: 150 });
        expect(tooMuch.status).toBe(400);

        const archived = await owner.agent
            .delete(`${base}/discount-types/${created.body.discountType.id}`)
            .set('Authorization', owner.auth);
        expect(archived.status).toBe(204);

        const list = await cashier.agent.get(`${base}/discount-types`).set('Authorization', cashier.auth);
        expect(list.body.discountTypes.map((t: { code: string }) => t.code)).toEqual(['SC', 'PWD']);

        const audit = await prisma.auditLog.findMany({ where: { action: { startsWith: 'DISCOUNT_TYPE_' } } });
        expect(audit.map((row) => row.action).sort()).toEqual(['DISCOUNT_TYPE_ARCHIVED', 'DISCOUNT_TYPE_CREATED']);
    });
});

describe('sales with discounts', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('prices a Senior line on the server and records the holder', async () => {
        const { store, owner, cashier, base, sc } = await setup();
        const a = await createProduct(store.id, { name: 'A', price: 112 });
        const b = await createProduct(store.id, { name: 'B', price: 56 });
        const c = await createProduct(store.id, { name: 'C', price: 224 });

        const res = await cashier.agent
            .post(`${base}/sales/finalize`)
            .set('Authorization', cashier.auth)
            .send({
                paymentMethod: 'CASH',
                items: [
                    { productId: a.id, qty: 1, unitPrice: 112, tax: 12 },
                    // Client amounts on a discounted line are ignored.
                    { productId: b.id, qty: 1, unitPrice: 56, discount: 50, tax: 6, discountRef: 'sc1' },
                    { productId: c.id, qty: 1, unitPrice: 224, tax: 24 },
                ],
                discounts: [
                    {
                        ref: 'sc1',
                        discountTypeId: sc.id,
                        scope: 'LINE',
                        holderName: 'Juan Dela Cruz',
                        holderIdNumber: 'OSCA-123456',
                    },
                ],
            });

        expect(res.status).toBe(201);
        const sale = res.body.sale;
        // Same totals convention as before: subtotal − discount = total.
        expect(sale).toMatchObject({
            subtotal: 392,
            discount: 16,
            tax: 36,
            total: 376,
            vatRemoved: 6,
            vatExemptSales: 50,
        });
        expect(sale.items[1]).toMatchObject({ discount: 16, tax: 0, total: 40, vatRemoved: 6, vatExemptSales: 50 });
        expect(sale.items[1].discountRef).toBe(sale.discounts[0].id);
        expect(sale.discounts[0]).toMatchObject({
            code: 'SC',
            scope: 'LINE',
            amount: 10,
            vatRemoved: 6,
            holderName: 'Juan Dela Cruz',
            // Cashiers can't edit sales, so they only see the last 4.
            holderIdNumber: '*******3456',
        });

        const asOwner = await owner.agent.get(`${base}/sales/${sale.id}`).set('Authorization', owner.auth);
        expect(asOwner.body.sale.discounts[0].holderIdNumber).toBe('OSCA-123456');
    });

    it('requires the holder details the discount type asks for', async () => {
        const { store, cashier, base, sc } = await setup();
        const product = await createProduct(store.id, { price: 100 });

        const res = await cashier.agent
            .post(`${base}/sales/finalize`)
            .set('Authorization', cashier.auth)
            .send({
                paymentMethod: 'CASH',
                items: [{ productId: product.id, qty: 1, unitPrice: 100, discountRef: 'x' }],
                discounts: [{ ref: 'x', discountTypeId: sc.id, scope: 'LINE', holderName: 'Maria' }],
            });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('DISCOUNT_HOLDER_REQUIRED');
        expect(await prisma.sale.count()).toBe(0);
    });

    it('keeps discounts through an edit and refuses edits that would drop them', async () => {
        const { store, owner, base, sc } = await setup();
        const product = await createProduct(store.id, { price: 112 });

        const created = await owner.agent
            .post(`${base}/sales/finalize`)
            .set('Authorization', owner.auth)
            .send({
                paymentMethod: 'CASH',
                items: [{ productId: product.id, qty: 1, unitPrice: 112, discountRef: 'p' }],
                discounts: [
                    { ref: 'p', discountTypeId: sc.id, scope: 'LINE', holderName: 'Ana', holderIdNumber: 'PWD-1' },
                ],
            });
        expect(created.status).toBe(201);
        const sale = created.body.sale;

        const legacyEdit = await owner.agent
            .patch(`${base}/sales/${sale.id}`)
            .set('Authorization', owner.auth)
            .send({
                paymentMethod: 'CASH',
                orderType: 'DINE_IN',
                items: [{ productId: product.id, qty: 2, unitPrice: 112 }],
            });
        expect(legacyEdit.status).toBe(409);
        expect(legacyEdit.body.error.code).toBe('DISCOUNTS_REQUIRED');

        const edited = await owner.agent
            .patch(`${base}/sales/${sale.id}`)
            .set('Authorization', owner.auth)
            .send({
                paymentMethod: 'CASH',
                orderType: 'DINE_IN',
                items: [{ productId: product.id, qty: 2, unitPrice: 112, discountRef: sale.discounts[0].ref }],
                discounts: sale.discounts.map((d: Record<string, unknown>) => ({
                    ref: d.ref,
                    discountTypeId: d.discountTypeId,
                    scope: d.scope,
                    holderName: d.holderName,
                    holderIdNumber: d.holderIdNumber,
                })),
            });
        expect(edited.status).toBe(200);
        // 224 → 200 without VAT (24) → 40 off → 160.
        expect(edited.body.sale).toMatchObject({ subtotal: 224, discount: 64, total: 160, tax: 0, vatRemoved: 24 });
        expect(edited.body.sale.discounts).toHaveLength(1);
        expect(edited.body.sale.discounts[0]).toMatchObject({ id: sale.discounts[0].id, amount: 40, holderName: 'Ana' });

        const audit = await prisma.auditLog.findFirst({ where: { action: 'SALE_EDITED' } });
        expect(JSON.stringify(audit?.meta)).not.toContain('PWD-1');
    });
});
