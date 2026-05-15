import 'dotenv/config';
import prisma from '../lib/prisma';

const parseRetentionDays = (value?: string) => {
    if (!value) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }
    return Math.floor(parsed);
};

const run = async () => {
    const now = new Date();
    const retentionDays = parseRetentionDays(process.env.AUDIT_LOG_RETENTION_DAYS);
    const retentionCutoff =
        retentionDays !== null
            ? new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
            : null;

    const [refreshTokens, resetTokens, verifyTokens, invites, auditLogs] = await prisma.$transaction([
        prisma.refreshToken.deleteMany({
            where: {
                OR: [
                    { expiresAt: { lt: now } },
                    { revokedAt: { not: null } },
                ],
            },
        }),
        prisma.passwordResetToken.deleteMany({
            where: {
                OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }],
            },
        }),
        prisma.emailVerificationToken.deleteMany({
            where: {
                OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }],
            },
        }),
        prisma.storeInvite.deleteMany({
            where: {
                OR: [{ expiresAt: { lt: now } }, { acceptedAt: { not: null } }],
            },
        }),
        retentionCutoff
            ? prisma.auditLog.deleteMany({
                  where: {
                      createdAt: { lt: retentionCutoff },
                  },
              })
            : prisma.auditLog.deleteMany({ where: { id: '__skip__' } }),
    ]);

    console.log('Cleanup complete', {
        refreshTokens: refreshTokens.count,
        passwordResetTokens: resetTokens.count,
        emailVerificationTokens: verifyTokens.count,
        invites: invites.count,
        auditLogs: retentionCutoff ? auditLogs.count : 0,
    });
};

run()
    .catch((error) => {
        console.error('Cleanup failed', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
