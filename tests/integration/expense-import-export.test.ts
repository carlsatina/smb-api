import { Role } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../lib/prisma';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

const login = async (agent: ReturnType<typeof createTestApp>, email: string, password: string) => {
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

const upload = (agent: ReturnType<typeof createTestApp>, storeId: string, token: string, csv: string) =>
    agent
        .post(`/api/v1/stores/${storeId}/expenses/import`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from(csv), { filename: 'expenses.csv', contentType: 'text/csv' });

describe('expense CSV import/export', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('imports expenses, skips rows already on file and reports row errors', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id);
        await prisma.store.update({ where: { id: store.id }, data: { expenseCategoryOptions: ['Supplies'] } });
        await prisma.expense.create({
            data: { storeId: store.id, createdById: user.id, date: new Date('2026-11-01T00:00:00Z'), amount: 50, category: 'Supplies', note: 'Ice' },
        });

        const agent = createTestApp();
        const token = await login(agent, user.email, password);
        const csv = [
            'Date,Category,Amount,Note',
            '2026-11-01,supplies,50,ice', // already on file -> skipped
            '2026-11-01,Supplies,50,Ice', // second identical row -> added
            '11/2/2026,Utilities,"1,250.75",Electric',
            '2026-11-03,Supplies,-4,', // invalid -> failed
        ].join('\n');

        const res = await upload(agent, store.id, token, csv);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ imported: 2, skipped: 1, failed: 1 });
        expect(res.body.errors[0].row).toBe(5);

        const rows = await prisma.expense.findMany({ where: { storeId: store.id }, orderBy: { date: 'asc' } });
        expect(rows).toHaveLength(3);
        expect(rows.every((r) => r.source === 'MANUAL')).toBe(true);
        expect(Number(rows[2].amount)).toBe(1250.75);

        const audit = await prisma.auditLog.findFirst({ where: { storeId: store.id, action: 'EXPENSES_IMPORTED' } });
        expect(audit?.meta).toMatchObject({ imported: 2, skipped: 1 });

        // Re-importing the same file adds nothing new.
        const again = await upload(agent, store.id, token, csv);
        expect(again.body).toMatchObject({ imported: 0, skipped: 3, failed: 1 });
    });

    it('exports the filtered range and round-trips without duplicates', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id);
        await prisma.expense.createMany({
            data: [
                { storeId: store.id, createdById: user.id, date: new Date('2026-11-05T00:00:00Z'), amount: 99.5, category: 'Supplies', note: '=SUM(A1)' },
                { storeId: store.id, createdById: user.id, date: new Date('2026-10-05T00:00:00Z'), amount: 10, category: 'Supplies' },
            ],
        });

        const agent = createTestApp();
        const token = await login(agent, user.email, password);
        const res = await agent
            .get(`/api/v1/stores/${store.id}/expenses/export?from=2026-11-01&to=2026-11-30`)
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('expenses-2026-11-01_to_2026-11-30.csv');
        expect(res.text).toContain("2026-11-05,Supplies,99.50,'=SUM(A1)");
        expect(res.text).not.toContain('2026-10-05');

        const again = await upload(agent, store.id, token, res.text);
        expect(again.body).toMatchObject({ imported: 0, skipped: 1, failed: 0 });
    });

    it('hides rent and salaries from members without payroll access and blocks cashier imports', async () => {
        const { user: owner } = await createUser();
        const store = await createStoreWithOwner(owner.id);
        await prisma.expense.create({
            data: { storeId: store.id, createdById: owner.id, date: new Date('2026-11-01T00:00:00Z'), amount: 15000, category: 'Rent' },
        });
        const { user: cashier, password } = await createUser();
        await prisma.storeMember.create({ data: { storeId: store.id, userId: cashier.id, role: Role.CASHIER } });

        const agent = createTestApp();
        const token = await login(agent, cashier.email, password);
        const exported = await agent.get(`/api/v1/stores/${store.id}/expenses/export`).set('Authorization', `Bearer ${token}`);
        expect(exported.status).toBe(200);
        expect(exported.text).not.toContain('Rent');

        const res = await upload(agent, store.id, token, 'Date,Category,Amount\n2026-11-01,Supplies,5');
        expect(res.status).toBe(403);
    });

    it('rejects a file without the required columns', async () => {
        const { user, password } = await createUser();
        const store = await createStoreWithOwner(user.id);
        const agent = createTestApp();
        const token = await login(agent, user.email, password);

        const res = await upload(agent, store.id, token, 'Date,Amount\n2026-11-01,5');
        expect(res.status).toBe(400);
    });
});
