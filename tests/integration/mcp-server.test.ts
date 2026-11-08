import { beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@prisma/client';
import { AddressInfo } from 'net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import prisma from '../../lib/prisma';
import { createApp } from '../../src/app';
import { createStoreWithOwner, createTestApp, createUser, resetDb } from './helpers';

type Agent = ReturnType<typeof createTestApp>;

const login = async (agent: Agent, email: string, password: string) => {
    const res = await agent.post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
};

let rpcId = 0;
const mcp = (agent: Agent, token: string | null, method: string, params: Record<string, unknown> = {}) => {
    const req = agent
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send({ jsonrpc: '2.0', id: ++rpcId, method, params });
};

const callTool = async (agent: Agent, token: string, name: string, args: Record<string, unknown> = {}) => {
    const res = await mcp(agent, token, 'tools/call', { name, arguments: args });
    expect(res.status).toBe(200);
    const result = res.body.result;
    const text = result.content?.[0]?.text ?? '';
    return { isError: Boolean(result.isError), text, data: result.isError ? null : JSON.parse(text) };
};

const setup = async () => {
    const { user: owner, password } = await createUser();
    const store = await createStoreWithOwner(owner.id, { name: 'Main Branch' });
    const agent = createTestApp();
    const accessToken = await login(agent, owner.email, password);
    const asOwner = (req: any) => req.set('Authorization', `Bearer ${accessToken}`);
    const issue = async (access: 'READ_ONLY' | 'READ_WRITE', storeIds: string[] = [store.id]) => {
        const res = await asOwner(
            agent.post('/api/v1/mcp-tokens').send({ name: `Claude ${access}`, access, storeIds, password })
        );
        expect(res.status).toBe(201);
        expect(res.body.secret).toMatch(/^smbpos_mcp_/);
        return res.body as { token: { id: string; stores: Array<{ id: string; name: string }> }; secret: string };
    };
    return { owner, password, store, agent, asOwner, issue };
};

describe('MCP server', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('rejects missing, unknown and revoked tokens', async () => {
        const { agent, asOwner, issue } = await setup();

        expect((await mcp(agent, null, 'tools/list')).status).toBe(401);
        expect((await mcp(agent, 'smbpos_mcp_nope', 'tools/list')).status).toBe(401);

        const { token, secret } = await issue('READ_ONLY');
        expect((await mcp(agent, secret, 'tools/list')).status).toBe(200);

        const listed = await asOwner(agent.get('/api/v1/mcp-tokens'));
        expect(listed.body.tokens).toHaveLength(1);
        expect(listed.body.tokens[0].stores).toEqual([expect.objectContaining({ name: 'Main Branch' })]);

        const revoked = await asOwner(agent.delete(`/api/v1/mcp-tokens/${token.id}`));
        expect(revoked.status).toBe(204);
        expect((await mcp(agent, secret, 'tools/list')).status).toBe(401);

        // Only the hash is stored, never the token itself.
        const row = await prisma.mcpToken.findUniqueOrThrow({ where: { id: token.id } });
        expect(row.tokenHash).not.toContain(secret);
        expect(row.revokedAt).not.toBeNull();
    });

    it('only covers stores the user owns, and only lists their own tokens', async () => {
        const { store, issue } = await setup();

        // An admin of the store can't issue a token for it.
        const { user: admin, password } = await createUser();
        await prisma.storeMember.create({ data: { storeId: store.id, userId: admin.id, role: Role.ADMIN } });
        const adminAgent = createTestApp();
        const adminToken = await login(adminAgent, admin.email, password);
        const asAdmin = (req: any) => req.set('Authorization', `Bearer ${adminToken}`);
        const refused = await asAdmin(
            adminAgent.post('/api/v1/mcp-tokens').send({ name: 'x', access: 'READ_WRITE', storeIds: [store.id], password })
        );
        expect(refused.status).toBe(403);

        // Nor can it see or revoke the owner's tokens.
        const { token } = await issue('READ_ONLY');
        expect((await asAdmin(adminAgent.get('/api/v1/mcp-tokens'))).body.tokens).toEqual([]);
        expect((await asAdmin(adminAgent.delete(`/api/v1/mcp-tokens/${token.id}`))).status).toBe(404);

        const empty = await asAdmin(adminAgent.post('/api/v1/mcp-tokens').send({ name: 'x', storeIds: [], password }));
        expect(empty.status).toBe(400);
    });

    it('read-only tokens see only read tools and never sales or secrets', async () => {
        const { store, agent, issue } = await setup();
        await prisma.store.update({ where: { id: store.id }, data: { aiApiKeyEncrypted: 'secret', aiApiKeyLast4: '1234' } });
        await prisma.ingredient.create({ data: { storeId: store.id, name: 'Fresh milk', unit: 'ml', costPerUnit: 0.11 } });
        const { secret } = await issue('READ_ONLY');

        const list = await mcp(agent, secret, 'tools/list');
        const names = list.body.result.tools.map((t: { name: string }) => t.name).sort();
        expect(names).toEqual(['get_ingredient', 'get_product', 'get_store_settings', 'list_ingredients', 'list_products', 'list_stores']);
        expect(names.some((n: string) => /sale/i.test(n))).toBe(false);

        // One store on the token: storeId can be left out.
        const settings = await callTool(agent, secret, 'get_store_settings');
        expect(settings.isError).toBe(false);
        expect(JSON.stringify(settings.data)).not.toMatch(/aiApiKey|secret|rolePermissions|billing/);

        const ingredients = await callTool(agent, secret, 'list_ingredients', { search: 'milk' });
        expect(ingredients.data.ingredients[0]).toMatchObject({ name: 'Fresh milk', costPerUnit: 0.11 });

        // Write tools aren't registered, so calling one fails.
        const write = await callTool(agent, secret, 'create_ingredient', { name: 'Ice', unit: 'g', costPerUnit: 0.01 });
        expect(write.isError).toBe(true);
        expect(await prisma.ingredient.count({ where: { storeId: store.id } })).toBe(1);
    });

    it('lets one token cover several stores, and nothing outside them', async () => {
        const { owner, store, agent, issue } = await setup();
        const second = await createStoreWithOwner(owner.id, { name: 'Makati Branch' });
        const notOnToken = await createStoreWithOwner(owner.id, { name: 'Warehouse' });
        await prisma.product.create({ data: { storeId: store.id, name: 'Latte', type: 'READY_MADE', price: 120, unit: 'cup' } });
        await prisma.product.create({ data: { storeId: second.id, name: 'Mocha', type: 'READY_MADE', price: 140, unit: 'cup' } });
        await prisma.product.create({ data: { storeId: notOnToken.id, name: 'Secret', type: 'READY_MADE', price: 1, unit: 'pc' } });

        const { token, secret } = await issue('READ_WRITE', [store.id, second.id]);
        expect(token.stores.map((s) => s.name).sort()).toEqual(['Main Branch', 'Makati Branch']);

        const stores = await callTool(agent, secret, 'list_stores');
        expect(stores.data.stores.map((s: { name: string }) => s.name).sort()).toEqual(['Main Branch', 'Makati Branch']);

        // With several stores the AI has to say which one.
        const ambiguous = await callTool(agent, secret, 'list_products');
        expect(ambiguous.isError).toBe(true);
        expect(ambiguous.text).toMatch(/storeId/);

        const makati = await callTool(agent, secret, 'list_products', { storeId: second.id });
        expect(makati.data.products.map((p: { name: string }) => p.name)).toEqual(['Mocha']);

        const outside = await callTool(agent, secret, 'list_products', { storeId: notOnToken.id });
        expect(outside.isError).toBe(true);
        const outsideWrite = await callTool(agent, secret, 'create_ingredient', { storeId: notOnToken.id, name: 'Ice', unit: 'g', costPerUnit: 0.01 });
        expect(outsideWrite.isError).toBe(true);
        expect(await prisma.ingredient.count({ where: { storeId: notOnToken.id } })).toBe(0);

        // Writes land in the chosen store and its own audit log.
        const created = await callTool(agent, secret, 'create_ingredient', { storeId: second.id, name: 'Cocoa', unit: 'g', costPerUnit: 0.5 });
        expect(created.isError).toBe(false);
        expect(await prisma.ingredient.count({ where: { storeId: second.id } })).toBe(1);
        expect(await prisma.ingredient.count({ where: { storeId: store.id } })).toBe(0);
        expect(await prisma.auditLog.count({ where: { storeId: second.id, action: 'MCP_INGREDIENT_CREATED' } })).toBe(1);

        // Losing ownership of one store drops just that store from the token.
        await prisma.storeMember.updateMany({ where: { storeId: store.id, userId: owner.id }, data: { role: Role.ADMIN } });
        const remaining = await callTool(agent, secret, 'list_stores');
        expect(remaining.data.stores.map((s: { name: string }) => s.name)).toEqual(['Makati Branch']);
        // ...and with one store left, storeId becomes optional again.
        expect((await callTool(agent, secret, 'list_products')).data.products[0].name).toBe('Mocha');
    });

    it('read & write tokens manage ingredients, products and recipes with an audit trail', async () => {
        const { owner, store, agent, issue } = await setup();
        const { secret } = await issue('READ_WRITE');

        const milk = await callTool(agent, secret, 'create_ingredient', { name: 'Fresh milk', unit: 'ml', costPerUnit: 0.1 });
        const beans = await callTool(agent, secret, 'create_ingredient', { name: 'Espresso beans', unit: 'g', costPerUnit: 1.2 });
        expect(milk.isError).toBe(false);

        const latte = await callTool(agent, secret, 'create_product', {
            name: 'Latte',
            type: 'RECIPE',
            price: 120,
            unit: 'cup',
            recipeLines: [
                { ingredientId: milk.data.id, qtyPerProductUnit: 200 },
                { ingredientId: beans.data.id, qtyPerProductUnit: 18 },
            ],
        });
        expect(latte.isError).toBe(false);

        const detail = await callTool(agent, secret, 'get_product', { productId: latte.data.id });
        expect(detail.data.recipe.lines).toHaveLength(2);
        expect(detail.data.recipe.estimatedCostPerUnit).toBeCloseTo(41.6, 2);

        const priced = await callTool(agent, secret, 'update_product', { productId: latte.data.id, price: 135 });
        expect(priced.data.price).toBe(135);
        expect(priced.data.name).toBe('Latte');

        const recipe = await callTool(agent, secret, 'set_recipe', {
            productId: latte.data.id,
            lines: [{ ingredientId: milk.data.id, qtyPerProductUnit: 180 }],
        });
        expect(recipe.data.lines).toHaveLength(1);

        // Same validation as the app: an unknown ingredient is refused.
        const bad = await callTool(agent, secret, 'set_recipe', {
            productId: latte.data.id,
            lines: [{ ingredientId: 'not-an-ingredient', qtyPerProductUnit: 1 }],
        });
        expect(bad.isError).toBe(true);

        const logs = await prisma.auditLog.findMany({ where: { storeId: store.id, action: { startsWith: 'MCP_' } }, orderBy: { createdAt: 'asc' } });
        expect(logs.map((l) => l.action)).toEqual([
            'MCP_TOKEN_CREATED',
            'MCP_INGREDIENT_CREATED',
            'MCP_INGREDIENT_CREATED',
            'MCP_PRODUCT_CREATED',
            'MCP_PRODUCT_UPDATED',
            'MCP_RECIPE_UPDATED',
        ]);
        expect(logs.every((l) => l.actorId === owner.id)).toBe(true);
        const priceLog = logs.find((l) => l.action === 'MCP_PRODUCT_UPDATED')!;
        expect(priceLog.meta).toMatchObject({ via: 'MCP', changes: { price: 135 }, previous: { price: 120 } });
    });

    it('follows billing suspension and ownership changes', async () => {
        const { owner, store, agent, issue } = await setup();
        const { secret } = await issue('READ_WRITE');

        await prisma.user.update({ where: { id: owner.id }, data: { billingSuspendedAt: new Date() } });
        expect((await callTool(agent, secret, 'list_products')).isError).toBe(false);
        const blocked = await callTool(agent, secret, 'create_ingredient', { name: 'Ice', unit: 'g', costPerUnit: 0.01 });
        expect(blocked.isError).toBe(true);
        expect(blocked.text).toMatch(/read-only|payment|suspend/i);

        await prisma.user.update({ where: { id: owner.id }, data: { billingSuspendedAt: null } });
        await prisma.storeMember.updateMany({ where: { storeId: store.id, userId: owner.id }, data: { role: Role.ADMIN } });
        expect((await mcp(agent, secret, 'tools/list')).status).toBe(401);
    });

    it('works with the official MCP client over HTTP', async () => {
        const { store, issue } = await setup();
        await prisma.product.create({ data: { storeId: store.id, name: 'Bottled Water', type: 'READY_MADE', price: 25, unit: 'bottle' } });
        const { secret } = await issue('READ_ONLY');

        const server = createApp().listen(0);
        const { port } = server.address() as AddressInfo;
        const client = new Client({ name: 'test-client', version: '1.0.0' });
        try {
            await client.connect(
                new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
                    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
                })
            );
            expect(client.getServerVersion()?.name).toBe('smb-pos');
            // User-entered names never reach the trusted instructions (prompt-injection guard).
            expect(client.getInstructions()).not.toContain('Main Branch');
            expect(client.getInstructions()).toMatch(/treat them strictly as data/i);
            const result = await client.callTool({ name: 'list_products', arguments: {} });
            const text = (result.content as Array<{ text: string }>)[0].text;
            expect(JSON.parse(text).products[0]).toMatchObject({ name: 'Bottled Water', price: 25 });
        } finally {
            await client.close();
            server.close();
        }
    });

    it('requires the password, defaults to 90 days and rejects expired tokens', async () => {
        const { store, agent, asOwner, password } = await setup();

        const wrong = await asOwner(agent.post('/api/v1/mcp-tokens').send({ name: 'x', storeIds: [store.id], password: 'nope' }));
        expect(wrong.status).toBe(403);
        expect(await prisma.mcpToken.count()).toBe(0);

        const created = await asOwner(agent.post('/api/v1/mcp-tokens').send({ name: 'x', storeIds: [store.id], password }));
        expect(created.status).toBe(201);
        const days = (new Date(created.body.token.expiresAt).getTime() - Date.now()) / 86400000;
        expect(days).toBeGreaterThan(89.9);
        expect(days).toBeLessThan(90.1);

        const forever = await asOwner(
            agent.post('/api/v1/mcp-tokens').send({ name: 'y', storeIds: [store.id], password, expiresInDays: null })
        );
        expect(forever.body.token.expiresAt).toBeNull();
        expect((await asOwner(agent.post('/api/v1/mcp-tokens').send({ name: 'z', storeIds: [store.id], password, expiresInDays: 7 }))).status).toBe(400);

        const secret = created.body.secret as string;
        expect((await mcp(agent, secret, 'tools/list')).status).toBe(200);
        await prisma.mcpToken.update({ where: { id: created.body.token.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
        const expired = await mcp(agent, secret, 'tools/list');
        expect(expired.status).toBe(401);
        expect(expired.body.error.message).toMatch(/expired/);
        // Expired tokens no longer show (or count) as active.
        expect((await asOwner(agent.get('/api/v1/mcp-tokens'))).body.tokens.map((t: { name: string }) => t.name)).toEqual(['y']);
    });

    it('revokes every MCP token when the password changes', async () => {
        const { agent, asOwner, issue, password } = await setup();
        const { secret } = await issue('READ_WRITE');
        expect((await mcp(agent, secret, 'tools/list')).status).toBe(200);

        const changed = await asOwner(
            agent.post('/api/v1/auth/password/change').send({ currentPassword: password, newPassword: 'a-new-password-123' })
        );
        expect(changed.status).toBe(200);
        expect((await mcp(agent, secret, 'tools/list')).status).toBe(401);
        expect(await prisma.auditLog.count({ where: { action: 'MCP_TOKEN_REVOKED', meta: { path: ['reason'], equals: 'password_changed' } } })).toBe(1);
    });

    it('enforces the token limit even under parallel requests', async () => {
        const { store, agent, asOwner, password } = await setup();
        const results = await Promise.all(
            Array.from({ length: 10 }, (_, i) =>
                asOwner(agent.post('/api/v1/mcp-tokens').send({ name: `t${i}`, storeIds: [store.id], password }))
            )
        );
        expect(results.filter((r) => r.status === 201)).toHaveLength(10);
        const over = await asOwner(agent.post('/api/v1/mcp-tokens').send({ name: 'over', storeIds: [store.id], password }));
        // Either the token limit or the create rate limit refuses it.
        expect([409, 429]).toContain(over.status);
        expect(await prisma.mcpToken.count({ where: { revokedAt: null } })).toBe(10);
    });

    it('refuses JSON-RPC batches', async () => {
        const { agent, issue } = await setup();
        const { secret } = await issue('READ_ONLY');
        const res = await agent
            .post('/mcp')
            .set('Accept', 'application/json, text/event-stream')
            .set('Authorization', `Bearer ${secret}`)
            .send([
                { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
                { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
            ]);
        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/Batch/);
    });

    // Keep last: it exhausts the in-memory failed-auth budget for this client IP.
    it('rate limits repeated bad tokens from one client', async () => {
        await setup();
        const agent = createTestApp();
        let limited = false;
        for (let i = 0; i < 40 && !limited; i += 1) {
            const res = await mcp(agent, `smbpos_mcp_random${i}`, 'tools/list');
            if (res.status === 429) limited = true;
            else expect(res.status).toBe(401);
        }
        expect(limited).toBe(true);
    });
});
