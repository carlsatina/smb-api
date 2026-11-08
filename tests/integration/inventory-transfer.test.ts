import { beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

type Agent = ReturnType<typeof createTestApp>;

const login = async (agent: Agent, email: string, password: string) => {
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

const setup = async () => {
    const { user: owner, password } = await createUser();
    // Negative stock allowed so the tests don't need opening balances.
    const source = await createStoreWithOwner(owner.id, { name: 'Main Branch', allowNegativeStock: true });
    const ingredient = await prisma.ingredient.create({
        data: { storeId: source.id, name: 'Fresh milk', unit: 'ml', costPerUnit: 0.11 },
    });
    const agent = createTestApp();
    const token = await login(agent, owner.email, password);
    const as = (req: any) => req.set('Authorization', `Bearer ${token}`);
    const transfer = (destinationStoreId: string, qty = 500) =>
        as(agent.post(`/api/v1/stores/${source.id}/inventory/transfers`)).send({
            destinationStoreId,
            itemType: 'INGREDIENT',
            itemId: ingredient.id,
            qty,
        });
    const batch = (destinationStoreId: string) =>
        as(agent.post(`/api/v1/stores/${source.id}/inventory/transfers/batch`)).send({
            destinationStoreId,
            items: [{ itemType: 'INGREDIENT', itemId: ingredient.id, qty: 250 }],
        });
    return { owner, source, ingredient, transfer, batch };
};

const ingredientsIn = (storeId: string) => prisma.ingredient.count({ where: { storeId } });

describe('inventory transfers', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('moves stock to another store the user manages', async () => {
        const { owner, transfer, batch } = await setup();
        const warehouse = await createStoreWithOwner(owner.id, { name: 'Warehouse' });

        expect((await transfer(warehouse.id)).status).toBe(201);
        expect((await batch(warehouse.id)).status).toBe(201);

        const copy = await prisma.ingredient.findFirstOrThrow({ where: { storeId: warehouse.id, name: 'Fresh milk' } });
        const moved = await prisma.inventoryMovement.aggregate({
            where: { storeId: warehouse.id, itemType: 'INGREDIENT', itemId: copy.id },
            _sum: { qtyDelta: true },
        });
        expect(Number(moved._sum.qtyDelta)).toBe(750);
    });

    it("refuses to write into another business's store", async () => {
        const { transfer, batch } = await setup();
        const { user: stranger } = await createUser();
        const foreign = await createStoreWithOwner(stranger.id, { name: 'Someone else' });

        for (const res of [await transfer(foreign.id), await batch(foreign.id)]) {
            expect(res.status).toBe(403);
            expect(res.body.error.message).toMatch(/manage stock/);
        }
        // Nothing was created or moved in the victim's store.
        expect(await ingredientsIn(foreign.id)).toBe(0);
        expect(await prisma.inventoryMovement.count({ where: { storeId: foreign.id } })).toBe(0);
    });

    it("doesn't reveal whether an inaccessible store id exists", async () => {
        const { transfer } = await setup();
        const { user: stranger } = await createUser();
        const foreign = await createStoreWithOwner(stranger.id);

        const real = await transfer(foreign.id);
        const fake = await transfer('cl000000000000000000fake');
        expect(real.status).toBe(403);
        expect(fake.status).toBe(403);
        expect(fake.body.error.message).toBe(real.body.error.message);
    });

    it('requires "Manage products & stock" in the destination, not just membership', async () => {
        const { owner, transfer, source } = await setup();
        const { user: other } = await createUser();
        const viewerStore = await createStoreWithOwner(other.id, { name: 'Viewer store' });
        await prisma.storeMember.create({ data: { storeId: viewerStore.id, userId: owner.id, role: Role.VIEWER } });

        expect((await transfer(viewerStore.id)).status).toBe(403);
        expect(await ingredientsIn(viewerStore.id)).toBe(0);

        // A suspended membership doesn't count either.
        const managed = await createStoreWithOwner(other.id, { name: 'Managed store' });
        await prisma.storeMember.create({
            data: { storeId: managed.id, userId: owner.id, role: Role.INVENTORY_MANAGER, suspendedAt: new Date() },
        });
        expect((await transfer(managed.id)).status).toBe(403);

        // Once reinstated as inventory manager, the transfer goes through.
        await prisma.storeMember.updateMany({ where: { storeId: managed.id, userId: owner.id }, data: { suspendedAt: null } });
        expect((await transfer(managed.id)).status).toBe(201);
        expect(source.id).not.toBe(managed.id);
    });
});
