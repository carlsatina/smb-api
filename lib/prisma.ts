import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
}

const parseConnectionConfig = (raw: string) => {
    try {
        const url = new URL(raw);
        const schema = url.searchParams.get('schema');
        if (schema) {
            url.searchParams.delete('schema');
            const options = url.searchParams.get('options');
            const searchPathOption = `-c search_path=${schema}`;
            url.searchParams.set(
                'options',
                options ? `${options} ${searchPathOption}` : searchPathOption
            );
        }
        return { connectionString: url.toString(), schema };
    } catch {
        return { connectionString: raw, schema: undefined };
    }
};

const { connectionString: baseUrl, schema } = parseConnectionConfig(connectionString);
const pool = new Pool({ connectionString: baseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export default prisma;
