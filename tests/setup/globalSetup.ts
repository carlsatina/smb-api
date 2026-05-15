import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Client } from 'pg';

const testStatePath = path.resolve(__dirname, '../.test-db.json');

export default async () => {
    if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
        throw new Error('Integration tests are disabled. Set RUN_INTEGRATION_TESTS=true to run.');
    }

    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) {
        throw new Error('DATABASE_URL must be set to run integration tests.');
    }

    const schema = `test_${crypto.randomUUID().replace(/-/g, '')}`;
    const url = new URL(baseUrl);
    url.searchParams.set('schema', schema);

    fs.writeFileSync(testStatePath, JSON.stringify({ schema, testUrl: url.toString() }, null, 2));

    execSync('npx prisma migrate deploy', {
        cwd: path.resolve(__dirname, '../..'),
        env: {
            ...process.env,
            DATABASE_URL: url.toString(),
        },
        stdio: 'inherit',
    });

    return async () => {
        if (!fs.existsSync(testStatePath)) {
            return;
        }

        const raw = fs.readFileSync(testStatePath, 'utf-8');
        const state = JSON.parse(raw) as { schema: string; testUrl: string };

        const dropUrl = new URL(state.testUrl);
        dropUrl.searchParams.delete('schema');

        const client = new Client({ connectionString: dropUrl.toString() });
        await client.connect();
        await client.query(`DROP SCHEMA IF EXISTS "${state.schema}" CASCADE;`);
        await client.end();

        fs.unlinkSync(testStatePath);
    };
};
