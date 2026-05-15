import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, resetDb } from './helpers';

describe('auth flow', () => {
    beforeEach(async () => {
        await resetDb();
    });

    it('requires CSRF for refresh and logout', async () => {
        const { user, password } = await createUser();
        const agent = createTestApp();

        const loginRes = await agent.post('/api/v1/auth/login').send({
            email: user.email,
            password,
        });

        expect(loginRes.status).toBe(200);
        expect(loginRes.body.accessToken).toBeTruthy();
        expect(loginRes.body.csrfToken).toBeTruthy();

        const refreshWithoutCsrf = await agent.post('/api/v1/auth/refresh').send({});
        expect(refreshWithoutCsrf.status).toBe(403);

        const refreshRes = await agent
            .post('/api/v1/auth/refresh')
            .set('x-csrf-token', loginRes.body.csrfToken)
            .send({});

        expect(refreshRes.status).toBe(200);
        expect(refreshRes.body.accessToken).toBeTruthy();
        expect(refreshRes.body.csrfToken).toBeTruthy();

        const logoutRes = await agent
            .post('/api/v1/auth/logout')
            .set('x-csrf-token', refreshRes.body.csrfToken)
            .send({});

        expect(logoutRes.status).toBe(204);
    });
});
