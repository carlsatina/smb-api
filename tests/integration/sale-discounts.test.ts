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
    const sc = types.body.discountTypes.find((t: { code: string }) => t.code === 'SCPWD');

    return { store, owner: ownerSession, cashier: cashierSession, base, sc };
};

describe('discount types', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('creates one Senior/PWD preset whose rate the owner can change', async () => {
        const { owner, base, sc } = await setup();

        const list = await owner.agent.get(`${base}/discount-types`).set('Authorization', owner.auth);
        expect(list.body.discountTypes.map((t: { code: string }) => t.code)).toEqual(['SCPWD']);
        expect(sc).toMatchObject({
            statutory: true,
            method: 'PERCENT',
            value: 20,
            removesVat: true,
            holderName: 'REQUIRED',
            holderIdNumber: 'REQUIRED',
            holderTypes: [
                { code: 'SC', name: 'Senior Citizen' },
                { code: 'PWD', name: 'Person with Disability' },
            ],
            lockedFields: ['code', 'method'],
            legalDefaults: { value: 20, removesVat: true },
        });

        const fixedAmount = await owner.agent
            .patch(`${base}/discount-types/${sc.id}`)
            .set('Authorization', owner.auth)
            .send({ method: 'FIXED' });
        expect(fixedAmount.status).toBe(400);
        expect(fixedAmount.body.error.code).toBe('STATUTORY_DISCOUNT_LOCKED');

        // The owner may change the rate (e.g. 5% on basic necessities).
        const grocery = await owner.agent
            .patch(`${base}/discount-types/${sc.id}`)
            .set('Authorization', owner.auth)
            .send({ value: 5, removesVat: false });
        expect(grocery.status).toBe(200);
        expect(grocery.body.discountType).toMatchObject({ value: 5, removesVat: false });
        const audit = await prisma.auditLog.findFirst({ where: { action: 'DISCOUNT_TYPE_UPDATED' } });
        expect(audit?.meta).toMatchObject({ before: { value: 20 }, after: { value: 5, removesVat: false } });

        const relaxId = await owner.agent
            .patch(`${base}/discount-types/${sc.id}`)
            .set('Authorization', owner.auth)
            .send({ holderIdNumber: 'OPTIONAL', scope: 'LINE', value: 20, removesVat: true });
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
        expect(list.body.discountTypes.map((t: { code: string }) => t.code)).toEqual(['SCPWD']);

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
                        holderType: 'SC',
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

        // The history list shows who got which discount, but never ID numbers.
        const list = await owner.agent.get(`${base}/sales`).set('Authorization', owner.auth);
        const listed = list.body.sales.find((row: { id: string }) => row.id === sale.id);
        expect(listed.discounts).toEqual([
            expect.objectContaining({ code: 'SC', holderName: 'Juan Dela Cruz', amount: 10, vatRemoved: 6 }),
        ]);
        expect(listed.items.find((item: { discountRef?: string }) => item.discountRef)).toMatchObject({ name: 'B' });
        expect(JSON.stringify(list.body)).not.toContain('OSCA-123456');
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
                discounts: [{ ref: 'x', discountTypeId: sc.id, holderType: 'SC', scope: 'LINE', holderName: 'Maria' }],
            });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('DISCOUNT_HOLDER_REQUIRED');

        const noIdType = await cashier.agent
            .post(`${base}/sales/finalize`)
            .set('Authorization', cashier.auth)
            .send({
                paymentMethod: 'CASH',
                items: [{ productId: product.id, qty: 1, unitPrice: 100, discountRef: 'x' }],
                discounts: [{ ref: 'x', discountTypeId: sc.id, scope: 'LINE', holderName: 'Maria', holderIdNumber: 'X1' }],
            });
        expect(noIdType.status).toBe(400);
        expect(noIdType.body.error.code).toBe('HOLDER_TYPE_REQUIRED');
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
                    { ref: 'p', discountTypeId: sc.id, holderType: 'PWD', scope: 'LINE', holderName: 'Ana', holderIdNumber: 'PWD-1' },
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
        // The edit didn't resend the ID type; it stays PWD.
        expect(edited.body.sale.discounts[0]).toMatchObject({
            id: sale.discounts[0].id,
            code: 'PWD',
            name: 'Person with Disability',
            amount: 40,
            holderName: 'Ana',
        });

        const audit = await prisma.auditLog.findFirst({ where: { action: 'SALE_EDITED' } });
        expect(JSON.stringify(audit?.meta)).not.toContain('PWD-1');
    });
});

describe('discount reports', () => {
    beforeEach(async () => {
        await resetDb();
    });

    const ringUp = async (
        session: { agent: ReturnType<typeof createTestApp>; auth: string },
        base: string,
        body: Record<string, unknown>
    ) => {
        const res = await session.agent.post(`${base}/sales/finalize`).set('Authorization', session.auth).send(body);
        expect(res.status).toBe(201);
        return res.body.sale;
    };

    it('splits the sales summary discounts into VAT exemption, each type and the rest', async () => {
        const { store, owner, base, sc } = await setup();
        const product = await createProduct(store.id, { price: 112 });

        // Senior line: 112 → 100 (12 VAT) → 20 off.
        await ringUp(owner, base, {
            paymentMethod: 'CASH',
            items: [{ productId: product.id, qty: 1, unitPrice: 112, discountRef: 's' }],
            discounts: [{ ref: 's', discountTypeId: sc.id, holderType: 'SC', scope: 'LINE', holderName: 'Ana', holderIdNumber: 'OSCA-1' }],
        });
        // An older-style manual discount of 5.
        await ringUp(owner, base, {
            paymentMethod: 'CASH',
            items: [{ productId: product.id, qty: 1, unitPrice: 112, discount: 5, tax: 11.46 }],
        });

        const res = await owner.agent.get(`${base}/reports/sales-summary`).set('Authorization', owner.auth);
        expect(res.status).toBe(200);
        expect(res.body.totals).toMatchObject({
            grossSales: 224,
            discounts: 37,
            vatExemption: 12,
            otherDiscounts: 5,
            netSales: 187,
        });
        expect(res.body.totals.discountsByType).toEqual([
            { code: 'SC', name: 'Senior Citizen', amount: 20, vatRemoved: 12, count: 1 },
        ]);
    });

    it('lists holders in the discount book, masking IDs without the permission', async () => {
        const { store, owner, cashier, base, sc } = await setup();
        const product = await createProduct(store.id, { price: 400 });

        const { user: viewer, password } = await createUser();
        await prisma.storeMember.create({ data: { storeId: store.id, userId: viewer.id, role: Role.VIEWER } });
        const viewerSession = await login(viewer.email, password);

        // Group meal: 4 diners, 1 senior → a quarter of the 400 bill.
        const sale = await ringUp(owner, base, {
            paymentMethod: 'CASH',
            items: [{ productId: product.id, qty: 1, unitPrice: 400 }],
            discounts: [
                {
                    ref: 'g',
                    discountTypeId: sc.id,
                    holderType: 'SC',
                    scope: 'SALE',
                    dinerCount: 4,
                    holderCount: 1,
                    holderName: 'Lola Nena',
                    holderIdNumber: 'OSCA-998877',
                },
            ],
        });

        const asOwner = await owner.agent.get(`${base}/reports/discount-book?codes=SC,PWD`).set('Authorization', owner.auth);
        expect(asOwner.status).toBe(200);
        expect(asOwner.body.idsRevealed).toBe(true);
        expect(asOwner.body.entries).toHaveLength(1);
        // Share 100 → 89.29 VAT-exempt (10.71 VAT) → 17.86 off.
        expect(asOwner.body.entries[0]).toMatchObject({
            saleId: sale.id,
            receiptNumber: sale.receiptNumber,
            code: 'SC',
            holderName: 'Lola Nena',
            holderIdNumber: 'OSCA-998877',
            dinerCount: 4,
            holderCount: 1,
            grossSales: 100,
            vatExemptSales: 89.29,
            vatRemoved: 10.71,
        });
        const entry = asOwner.body.entries[0];
        expect(entry.netSales).toBeCloseTo(entry.grossSales - entry.vatRemoved - entry.discount, 2);

        const pwdOnly = await owner.agent.get(`${base}/reports/discount-book?codes=PWD`).set('Authorization', owner.auth);
        expect(pwdOnly.body.entries).toHaveLength(0);

        const asViewer = await viewerSession.agent.get(`${base}/reports/discount-book`).set('Authorization', viewerSession.auth);
        expect(asViewer.status).toBe(200);
        expect(asViewer.body.idsRevealed).toBe(false);
        expect(asViewer.body.entries[0].holderIdNumber).toBe('*******8877');

        const asCashier = await cashier.agent.get(`${base}/reports/discount-book`).set('Authorization', cashier.auth);
        expect(asCashier.status).toBe(403);

        const csv = await viewerSession.agent
            .get(`${base}/reports/discount-book/export?codes=SC`)
            .set('Authorization', viewerSession.auth);
        expect(csv.status).toBe(200);
        expect(csv.headers['content-type']).toContain('text/csv');
        const csvLines = csv.text.split('\n');
        expect(csvLines[0]).toContain('ID number');
        expect(csvLines[1]).toContain('Lola Nena');
        expect(csvLines[1]).toContain('*******8877');
        expect(csvLines[1]).not.toContain('OSCA-998877');
        expect(csvLines[csvLines.length - 1]).toMatch(/^Total,/);

        const audit = await prisma.auditLog.findFirst({ where: { action: 'DISCOUNT_BOOK_EXPORTED' } });
        expect(audit?.meta).toMatchObject({ rows: 1, idsRevealed: false, codes: ['SC'] });
    });

    it('keeps the real ID when an editor who sees masked IDs saves the sale', async () => {
        const { store, owner, cashier, base, sc } = await setup();
        const product = await createProduct(store.id, { price: 112 });
        // This cashier may edit sales but not see full IDs.
        await prisma.storeMember.updateMany({
            where: { storeId: store.id, role: Role.CASHIER },
            data: { permissionOverrides: { 'sales.edit': true } },
        });

        const sale = await ringUp(owner, base, {
            paymentMethod: 'CASH',
            items: [{ productId: product.id, qty: 1, unitPrice: 112, discountRef: 's' }],
            discounts: [{ ref: 's', discountTypeId: sc.id, holderType: 'SC', scope: 'LINE', holderName: 'Ana', holderIdNumber: 'OSCA-555666' }],
        });

        const seen = await cashier.agent.get(`${base}/sales/${sale.id}`).set('Authorization', cashier.auth);
        const masked = seen.body.sale.discounts[0];
        expect(masked.holderIdNumber).toBe('*******5666');

        const edited = await cashier.agent
            .patch(`${base}/sales/${sale.id}`)
            .set('Authorization', cashier.auth)
            .send({
                paymentMethod: 'GCASH',
                orderType: 'DINE_IN',
                items: [{ productId: product.id, qty: 1, unitPrice: 112, discountRef: masked.ref }],
                discounts: [
                    {
                        ref: masked.ref,
                        discountTypeId: masked.discountTypeId,
                        scope: masked.scope,
                        holderName: masked.holderName,
                        holderIdNumber: masked.holderIdNumber,
                    },
                ],
            });
        expect(edited.status).toBe(200);

        const stored = await prisma.saleDiscount.findFirst({ where: { saleId: sale.id } });
        expect(stored?.holderIdNumber).toBe('OSCA-555666');
    });
});
