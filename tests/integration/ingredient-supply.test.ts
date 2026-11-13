import { beforeEach, describe, expect, it } from 'vitest';
import { IngredientCategory, ProductType } from '@prisma/client';
import prisma from '../../lib/prisma';
import { createProduct, createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

const login = async (agent: ReturnType<typeof createTestApp>, email: string, password: string) => {
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

const createIngredient = (storeId: string, name: string, category: IngredientCategory) =>
    prisma.ingredient.create({ data: { storeId, name, unit: 'pc', category, costPerUnit: 1 } });

const setup = async () => {
    const { user, password } = await createUser();
    const store = await createStoreWithOwner(user.id);
    const agent = createTestApp();
    const token = await login(agent, user.email, password);
    return { store, agent, token };
};

describe('supply ingredients', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('creates a supply item', async () => {
        const { store, agent, token } = await setup();

        const res = await agent
            .post(`/api/v1/stores/${store.id}/ingredients`)
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Gloves', unit: 'pair', category: 'SUPPLY', costPerUnit: 2.5 });

        expect(res.status).toBe(201);
        expect(res.body.ingredient.category).toBe('SUPPLY');
    });

    it('rejects supplies in recipe lines', async () => {
        const { store, agent, token } = await setup();
        const product = await createProduct(store.id, { type: ProductType.RECIPE });
        const gloves = await createIngredient(store.id, 'Gloves', IngredientCategory.SUPPLY);

        const res = await agent
            .put(`/api/v1/stores/${store.id}/products/${product.id}/recipe-lines`)
            .set('Authorization', `Bearer ${token}`)
            .send({ lines: [{ ingredientId: gloves.id, qtyPerProductUnit: 1 }] });

        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe('INVALID_RECIPE_INGREDIENT');
    });

    it('rejects supplies as product packaging', async () => {
        const { store, agent, token } = await setup();
        const product = await createProduct(store.id);
        const trashBag = await createIngredient(store.id, 'Trash bag', IngredientCategory.SUPPLY);

        const res = await agent
            .put(`/api/v1/stores/${store.id}/products/${product.id}/packaging`)
            .set('Authorization', `Bearer ${token}`)
            .send({ lines: [{ ingredientId: trashBag.id, qtyPerUnit: 1 }] });

        expect(res.status).toBe(400);
    });

    it('blocks switching an ingredient used in a recipe to supply', async () => {
        const { store, agent, token } = await setup();
        const product = await createProduct(store.id, { type: ProductType.RECIPE });
        const sugar = await createIngredient(store.id, 'Sugar', IngredientCategory.RAW_MATERIAL);
        await prisma.recipe.create({
            data: {
                storeId: store.id,
                productId: product.id,
                lines: { create: [{ ingredientId: sugar.id, qtyPerProductUnit: 1 }] },
            },
        });

        const res = await agent
            .patch(`/api/v1/stores/${store.id}/ingredients/${sugar.id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ category: 'SUPPLY' });

        expect(res.status).toBe(409);
        const after = await prisma.ingredient.findUnique({ where: { id: sugar.id } });
        expect(after?.category).toBe('RAW_MATERIAL');
    });

    it('allows switching an unused ingredient to supply', async () => {
        const { store, agent, token } = await setup();
        const alcohol = await createIngredient(store.id, 'Alcohol', IngredientCategory.RAW_MATERIAL);

        const res = await agent
            .patch(`/api/v1/stores/${store.id}/ingredients/${alcohol.id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ category: 'SUPPLY' });

        expect(res.status).toBe(200);
        expect(res.body.ingredient.category).toBe('SUPPLY');
    });
});
