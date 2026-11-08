import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { getClientIp } from '../src/middlewares/rateLimit';

// Simulates Dokploy: Traefik appends the real peer address as the LAST
// X-Forwarded-For entry; anything before it came from the client.
const appWith = (hops: number) => {
    const app = express();
    app.set('trust proxy', hops);
    app.get('/', (req, res) => {
        res.json({ ip: getClientIp(req) });
    });
    return app;
};

describe('getClientIp', () => {
    it('uses the address the trusted proxy appended, not client-supplied entries', async () => {
        const app = appWith(1);
        const a = await request(app).get('/').set('X-Forwarded-For', '6.6.6.6, 203.0.113.7');
        const b = await request(app).get('/').set('X-Forwarded-For', '9.9.9.9, 203.0.113.7');
        expect(a.body.ip).toBe('203.0.113.7');
        expect(b.body.ip).toBe('203.0.113.7');
    });

    it('distinguishes real clients behind the proxy', async () => {
        const app = appWith(1);
        const a = await request(app).get('/').set('X-Forwarded-For', '203.0.113.7');
        const b = await request(app).get('/').set('X-Forwarded-For', '198.51.100.4');
        expect(a.body.ip).not.toBe(b.body.ip);
    });

    it('supports an extra proxy layer such as Cloudflare', async () => {
        const app = appWith(2);
        const res = await request(app).get('/').set('X-Forwarded-For', '6.6.6.6, 203.0.113.7, 172.18.0.5');
        expect(res.body.ip).toBe('203.0.113.7');
    });

    it('ignores X-Forwarded-For entirely without a trusted proxy', async () => {
        const res = await request(appWith(0)).get('/').set('X-Forwarded-For', '6.6.6.6');
        expect(res.body.ip).not.toBe('6.6.6.6');
    });
});
