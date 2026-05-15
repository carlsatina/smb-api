import fs from 'fs';
import path from 'path';
import { afterAll } from 'vitest';

const testStatePath = path.resolve(__dirname, '../.test-db.json');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
    throw new Error('Integration tests are disabled. Set RUN_INTEGRATION_TESTS=true to run.');
}

if (!fs.existsSync(testStatePath)) {
    throw new Error('Missing test database state file. Did globalSetup run?');
}

const raw = fs.readFileSync(testStatePath, 'utf-8');
const state = JSON.parse(raw) as { testUrl: string };

process.env.DATABASE_URL = state.testUrl;
process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test_access_secret';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'test_refresh_secret';
process.env.REFRESH_TOKEN_COOKIE_SECURE = 'false';
process.env.CSRF_COOKIE_SECURE = 'false';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS || '';
process.env.ERROR_REPORTING_TRACES_SAMPLE_RATE = '0';

afterAll(async () => {
    const prisma = (await import('../../lib/prisma')).default;
    await prisma.$disconnect();
});
