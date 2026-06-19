import { beforeEach, describe, expect, it } from 'vitest';
import { IngredientCategory, MovementType } from '@prisma/client';
import prisma from '../../lib/prisma';
import { createProduct, createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

const createPackagingIngredient = async (storeId: string, name = 'Takeout Plastic') => {
    return prisma.ingredient.create({
        data: {
            storeId,
            name,
            unit: 'pc',
            category: IngredientCategory.PACKAGING,
            costPerUnit: 1,
        },
    });
};

const seedStock = async (storeId: string, itemType: 'PRODUCT' | 'INGREDIENT', itemId: string, qty: number) => {
    await prisma.inventoryMovement.create({
        data: {
            storeId,
            itemType,
            itemId,
            qtyDelta: qty,
            type: MovementType.STOCK_ADJUSTMENT,
        },
    });
};

const stockOf = async (storeId: string, itemType: 'PRODUCT' | 'INGREDIENT', itemId: string) => {
    const result = await prisma.inventoryMovement.aggregate({
        where: { storeId, itemType, itemId },
        _sum: { qtyDelta: true },
    });
    return Number(result._sum.qtyDelta ?? 0);
};

const login = async (agent: ReturnType<typeof createTestApp>, email: string, password: string) => {
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

describe('sales finalize with takeout packaging', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('deducts packaging by item quantity on a takeout sale', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id, { allowNegativeStock: true });
        const product = await createProduct(store.id, { price: 25 });
        const packaging = await createPackagingIngredient(store.id);
        await prisma.productPackaging.create({
            data: { productId: product.id, ingredientId: packaging.id, qtyPerUnit: 1 },
        });

        const agent = createTestApp();
        const token = await login(agent, user.email, password);

        const res = await agent
            .post(`/api/v1/stores/${store.id}/sales/finalize`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                paymentMethod: 'CASH',
                orderType: 'TAKEOUT',
                items: [{ productId: product.id, qty: 3, unitPrice: 25 }],
            });

        expect(res.status).toBe(201);
        expect(res.body.sale?.orderType).toBe('TAKEOUT');
        // 3 items * 1 packaging per item = 3 deducted
        expect(await stockOf(store.id, 'INGREDIENT', packaging.id)).toBe(-3);
    });

    it('does not deduct packaging on a dine-in sale', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id, { allowNegativeStock: true });
        const product = await createProduct(store.id, { price: 25 });
        const packaging = await createPackagingIngredient(store.id);
        await prisma.productPackaging.create({
            data: { productId: product.id, ingredientId: packaging.id, qtyPerUnit: 1 },
        });

        const agent = createTestApp();
        const token = await login(agent, user.email, password);

        const res = await agent
            .post(`/api/v1/stores/${store.id}/sales/finalize`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                paymentMethod: 'CASH',
                orderType: 'DINE_IN',
                items: [{ productId: product.id, qty: 3, unitPrice: 25 }],
            });

        expect(res.status).toBe(201);
        expect(res.body.sale?.orderType).toBe('DINE_IN');
        expect(await stockOf(store.id, 'INGREDIENT', packaging.id)).toBe(0);
    });

    it('defaults to dine-in when orderType is omitted', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id, { allowNegativeStock: true });
        const product = await createProduct(store.id, { price: 25 });
        const packaging = await createPackagingIngredient(store.id);
        await prisma.productPackaging.create({
            data: { productId: product.id, ingredientId: packaging.id, qtyPerUnit: 2 },
        });

        const agent = createTestApp();
        const token = await login(agent, user.email, password);

        const res = await agent
            .post(`/api/v1/stores/${store.id}/sales/finalize`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                paymentMethod: 'CASH',
                items: [{ productId: product.id, qty: 1, unitPrice: 25 }],
            });

        expect(res.status).toBe(201);
        expect(res.body.sale?.orderType).toBe('DINE_IN');
        expect(await stockOf(store.id, 'INGREDIENT', packaging.id)).toBe(0);
    });

    it('returns packaging to stock when a takeout sale is voided', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id, { allowNegativeStock: true });
        const product = await createProduct(store.id, { price: 25 });
        const packaging = await createPackagingIngredient(store.id);
        await prisma.productPackaging.create({
            data: { productId: product.id, ingredientId: packaging.id, qtyPerUnit: 2 },
        });

        const agent = createTestApp();
        const token = await login(agent, user.email, password);

        const finalizeRes = await agent
            .post(`/api/v1/stores/${store.id}/sales/finalize`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                paymentMethod: 'CASH',
                orderType: 'TAKEOUT',
                items: [{ productId: product.id, qty: 2, unitPrice: 25 }],
            });
        expect(finalizeRes.status).toBe(201);
        // 2 items * 2 per item = 4 deducted
        expect(await stockOf(store.id, 'INGREDIENT', packaging.id)).toBe(-4);

        const voidRes = await agent
            .post(`/api/v1/stores/${store.id}/sales/${finalizeRes.body.sale.id}/void`)
            .set('Authorization', `Bearer ${token}`);
        expect(voidRes.status).toBe(200);
        // Reversal brings packaging back to net zero
        expect(await stockOf(store.id, 'INGREDIENT', packaging.id)).toBe(0);
    });

    it('blocks a takeout sale when packaging would go negative and negative stock is disallowed', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id, { allowNegativeStock: false });
        const product = await createProduct(store.id, { price: 25 });
        const packaging = await createPackagingIngredient(store.id);
        await prisma.productPackaging.create({
            data: { productId: product.id, ingredientId: packaging.id, qtyPerUnit: 1 },
        });
        // Product has stock, packaging does not.
        await seedStock(store.id, 'PRODUCT', product.id, 10);

        const agent = createTestApp();
        const token = await login(agent, user.email, password);

        const res = await agent
            .post(`/api/v1/stores/${store.id}/sales/finalize`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                paymentMethod: 'CASH',
                orderType: 'TAKEOUT',
                items: [{ productId: product.id, qty: 1, unitPrice: 25 }],
            });

        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe('NEGATIVE_STOCK');
    });
});
