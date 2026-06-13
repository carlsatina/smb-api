import { beforeEach, describe, expect, it } from 'vitest';
import { PlanTier } from '@prisma/client';
import prisma from '../../lib/prisma';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

const login = async (agent: ReturnType<typeof createTestApp>, email: string, password: string) => {
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

describe('ingredient CSV import/export', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('imports ingredients from CSV (create + upsert) and reports row errors', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id);

        // Existing ingredient that the import should update (match by name)
        await prisma.ingredient.create({
            data: { storeId: store.id, name: 'Sugar', unit: 'g', costPerUnit: 1, category: 'RAW_MATERIAL' },
        });

        const agent = createTestApp();
        const token = await login(agent, user.email, password);

        const csv = [
            'Name,Unit,Category,Cost Per Unit,Low Stock Threshold',
            'Sugar,kg,RAW_MATERIAL,2.5,10', // updates existing
            'Cups,pcs,PACKAGING,0.5,100', // new
            'Broken,pcs,PACKAGING,notanumber,5', // invalid -> failed
        ].join('\n');

        const res = await agent
            .post(`/api/v1/stores/${store.id}/ingredients/import`)
            .set('Authorization', `Bearer ${token}`)
            .attach('file', Buffer.from(csv), { filename: 'ingredients.csv', contentType: 'text/csv' });

        expect(res.status).toBe(200);
        expect(res.body.imported).toBe(1);
        expect(res.body.updated).toBe(1);
        expect(res.body.failed).toBe(1);
        expect(res.body.errors?.[0]?.row).toBe(4);

        const sugar = await prisma.ingredient.findFirst({ where: { storeId: store.id, name: 'Sugar' } });
        expect(sugar?.unit).toBe('kg');
        expect(Number(sugar?.costPerUnit)).toBe(2.5);

        const cups = await prisma.ingredient.findFirst({ where: { storeId: store.id, name: 'Cups' } });
        expect(cups?.category).toBe('PACKAGING');
    });

    it('exports ingredients as CSV with a filename and neutralizes formula injection', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id);

        await prisma.ingredient.create({
            data: { storeId: store.id, name: '=DANGER()', unit: 'g', costPerUnit: 1, category: 'RAW_MATERIAL' },
        });

        const agent = createTestApp();
        const token = await login(agent, user.email, password);

        const res = await agent
            .get(`/api/v1/stores/${store.id}/ingredients/export`)
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('ingredients-');
        // formula-injection guard prefixes the risky value with an apostrophe
        expect(res.text).toContain("'=DANGER()");
    });

    it('rejects non-CSV uploads with a 400', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id);

        const agent = createTestApp();
        const token = await login(agent, user.email, password);

        const res = await agent
            .post(`/api/v1/stores/${store.id}/ingredients/import`)
            .set('Authorization', `Bearer ${token}`)
            .attach('file', Buffer.from('not a csv'), { filename: 'notes.txt', contentType: 'text/plain' });

        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe('INVALID_FILE_TYPE');
    });

    it('blocks import/export on the Starter plan', async () => {
        const { user, password } = await createUser({ planTier: PlanTier.STARTER });
        const store = await createStoreWithOwner(user.id);

        const agent = createTestApp();
        const token = await login(agent, user.email, password);

        const res = await agent
            .get(`/api/v1/stores/${store.id}/ingredients/export`)
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(403);
    });
});
