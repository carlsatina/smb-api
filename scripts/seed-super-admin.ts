import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL is not set in .env');
}

const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SUPER_ADMIN_PASSWORD?.trim();
const fullName = process.env.SUPER_ADMIN_NAME?.trim() || 'Platform Admin';

if (!email) {
    console.error('Error: SUPER_ADMIN_EMAIL is not set in .env');
    process.exit(1);
}

if (!password || password.length < 8) {
    console.error('Error: SUPER_ADMIN_PASSWORD must be at least 8 characters');
    process.exit(1);
}

const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
});

const run = async () => {
    const passwordHash = await bcrypt.hash(password!, 10);

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
        await prisma.user.update({
            where: { email },
            data: {
                passwordHash,
                fullName,
                isSuperAdmin: true,
                emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
                subscriptionActive: true,
            },
        });
        console.log(`Updated existing user "${email}" — isSuperAdmin = true`);
    } else {
        await prisma.user.create({
            data: {
                email,
                passwordHash,
                fullName,
                isSuperAdmin: true,
                emailVerifiedAt: new Date(),
                subscriptionActive: true,
            },
        });
        console.log(`Created super admin "${email}"`);
    }

    console.log('Done. You can now log in at /login and access /admin.');
};

run()
    .catch((err) => {
        console.error('Seed failed:', err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
