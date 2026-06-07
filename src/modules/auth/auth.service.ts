import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../../../lib/prisma';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors';
import { sendPasswordResetEmail, sendVerificationEmail } from '../../shared/email';

const hashToken = (token: string) => {
    return crypto.createHash('sha256').update(token).digest('hex');
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const parseDurationToMs = (value: string) => {
    const match = value.match(/^(\d+)([smhd])$/);
    if (!match) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric * 1000;
        }
        return 7 * 24 * 60 * 60 * 1000;
    }
    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier =
        unit === 's'
            ? 1000
            : unit === 'm'
              ? 60 * 1000
              : unit === 'h'
                ? 60 * 60 * 1000
                : 24 * 60 * 60 * 1000;
    return amount * multiplier;
};

const signAccessToken = (userId: string, email: string, isSuperAdmin: boolean) => {
    return jwt.sign({ sub: userId, email, isSuperAdmin }, env.accessTokenSecret, {
        expiresIn: env.accessTokenExpiresIn as jwt.SignOptions['expiresIn'],
    });
};

const signRefreshToken = (userId: string) => {
    return jwt.sign(
        { sub: userId, tokenType: 'refresh', jti: crypto.randomBytes(16).toString('hex') },
        env.refreshTokenSecret,
        {
            expiresIn: env.refreshTokenExpiresIn as jwt.SignOptions['expiresIn'],
        }
    );
};

const storeRefreshToken = async (userId: string, token: string) => {
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + parseDurationToMs(env.refreshTokenExpiresIn));
    await prisma.refreshToken.create({
        data: {
            userId,
            tokenHash,
            expiresAt,
        },
    });
};

const revokeAllRefreshTokens = async (userId: string) => {
    await prisma.refreshToken.updateMany({
        where: {
            userId,
            revokedAt: null,
        },
        data: {
            revokedAt: new Date(),
        },
    });
};

const revokeRefreshToken = async (token: string) => {
    const tokenHash = hashToken(token);
    await prisma.refreshToken.updateMany({
        where: {
            tokenHash,
            revokedAt: null,
        },
        data: {
            revokedAt: new Date(),
        },
    });
};

const createPasswordResetToken = async (userId: string) => {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + parseDurationToMs(env.passwordResetExpiresIn));
    await prisma.passwordResetToken.create({
        data: {
            userId,
            tokenHash,
            expiresAt,
        },
    });
    return { token, expiresAt };
};

const createEmailVerificationToken = async (userId: string) => {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + parseDurationToMs(env.emailVerificationExpiresIn));

    await prisma.emailVerificationToken.updateMany({
        where: {
            userId,
            usedAt: null,
        },
        data: {
            usedAt: new Date(),
        },
    });

    await prisma.emailVerificationToken.create({
        data: {
            userId,
            tokenHash,
            expiresAt,
        },
    });

    return { token, expiresAt };
};

const sendVerificationForUser = async (user: { id: string; email: string; emailVerifiedAt: Date | null }) => {
    if (user.emailVerifiedAt) {
        return { sent: false };
    }
    const { token, expiresAt } = await createEmailVerificationToken(user.id);
    const verifyLink = `${env.appBaseUrl.replace(/\/$/, '')}/verify-email?token=${token}`;
    try {
        await sendVerificationEmail({ to: user.email, verifyLink, expiresAt });
        return { sent: true };
    } catch (error) {
        return { sent: false };
    }
};

export const authService = {
    register: async (email: string, password: string, fullName?: string, plan?: 'STANDARD' | 'GROWTH') => {
        const normalizedEmail = normalizeEmail(email);
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
            throw new AppError('EMAIL_IN_USE', 'Email already registered', 409);
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        const user = await prisma.user.create({
            data: {
                email: normalizedEmail,
                passwordHash,
                fullName,
                subscriptionActive: true,
                ...(plan && { grantedPlan: plan, grantedUntil: trialEndsAt }),
            },
        });

        const accessToken = signAccessToken(user.id, user.email, user.isSuperAdmin);
        const refreshToken = signRefreshToken(user.id);
        await storeRefreshToken(user.id, refreshToken);
        await sendVerificationForUser(user);

        return {
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                subscriptionActive: user.subscriptionActive,
                planTier: user.planTier,
                grantedPlan: user.grantedPlan,
                grantedUntil: user.grantedUntil,
                isSuperAdmin: user.isSuperAdmin,
                emailVerified: Boolean(user.emailVerifiedAt),
            },
            accessToken,
            refreshToken,
        };
    },
    login: async (email: string, password: string) => {
        const normalizedEmail = normalizeEmail(email);
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user) {
            throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
            throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
        }

        const accessToken = signAccessToken(user.id, user.email, user.isSuperAdmin);
        const refreshToken = signRefreshToken(user.id);
        await storeRefreshToken(user.id, refreshToken);

        return {
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                subscriptionActive: user.subscriptionActive,
                planTier: user.planTier,
                grantedPlan: user.grantedPlan,
                grantedUntil: user.grantedUntil,
                isSuperAdmin: user.isSuperAdmin,
                emailVerified: Boolean(user.emailVerifiedAt),
            },
            accessToken,
            refreshToken,
        };
    },
    refresh: async (refreshToken: string) => {
        let payload: { sub: string; tokenType: string };
        try {
            payload = jwt.verify(refreshToken, env.refreshTokenSecret) as {
                sub: string;
                tokenType: string;
            };
        } catch (error) {
            throw new AppError('INVALID_REFRESH', 'Invalid refresh token', 401);
        }

        if (!payload.sub || payload.tokenType !== 'refresh') {
            throw new AppError('INVALID_REFRESH', 'Invalid refresh token', 401);
        }

        const tokenHash = hashToken(refreshToken);
        const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
        if (!stored) {
            throw new AppError('INVALID_REFRESH', 'Refresh token expired or revoked', 401);
        }
        if (stored.userId !== payload.sub) {
            throw new AppError('INVALID_REFRESH', 'Invalid refresh token', 401);
        }
        if (stored.revokedAt) {
            await revokeAllRefreshTokens(stored.userId);
            throw new AppError('REFRESH_REUSE', 'Refresh token reuse detected', 401);
        }
        if (stored.expiresAt <= new Date()) {
            throw new AppError('INVALID_REFRESH', 'Refresh token expired or revoked', 401);
        }

        const user = await prisma.user.findUnique({ where: { id: stored.userId } });
        if (!user) {
            throw new AppError('INVALID_REFRESH', 'User not found', 401);
        }

        await revokeRefreshToken(refreshToken);
        const accessToken = signAccessToken(user.id, user.email, user.isSuperAdmin);
        const nextRefreshToken = signRefreshToken(payload.sub);
        await storeRefreshToken(payload.sub, nextRefreshToken);

        return {
            accessToken,
            refreshToken: nextRefreshToken,
        };
    },
    logout: async (refreshToken: string) => {
        await revokeRefreshToken(refreshToken);
    },
    requestPasswordReset: async (email: string) => {
        const normalizedEmail = normalizeEmail(email);
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user) {
            return { ok: true };
        }
        const { token, expiresAt } = await createPasswordResetToken(user.id);
        const baseUrl = env.appBaseUrl.replace(/\/$/, '');
        const resetLink = `${baseUrl}/reset-password?token=${token}`;
        try {
            await sendPasswordResetEmail({ to: user.email, resetLink, expiresAt });
        } catch (error) {
            console.error('Failed to send reset email', error);
        }
        return { ok: true };
    },
    requestEmailVerification: async (email: string) => {
        const normalizedEmail = normalizeEmail(email);
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user || user.emailVerifiedAt) {
            return { ok: true };
        }

        await sendVerificationForUser(user);
        return { ok: true };
    },
    resetPassword: async (token: string, password: string) => {
        const tokenHash = hashToken(token);
        const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
        if (!record || record.usedAt || record.expiresAt <= new Date()) {
            throw new AppError('INVALID_RESET', 'Invalid or expired reset token', 400);
        }

        const passwordHash = await bcrypt.hash(password, 10);
        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: record.userId },
                data: { passwordHash },
            });
            await tx.passwordResetToken.update({
                where: { id: record.id },
                data: { usedAt: new Date() },
            });
            await tx.refreshToken.updateMany({
                where: { userId: record.userId, revokedAt: null },
                data: { revokedAt: new Date() },
            });
        });

        return { ok: true };
    },
    verifyEmail: async (token: string) => {
        const tokenHash = hashToken(token);
        const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
        if (!record || record.usedAt || record.expiresAt <= new Date()) {
            throw new AppError('INVALID_VERIFY', 'Invalid or expired verification token', 400);
        }

        const user = await prisma.user.findUnique({ where: { id: record.userId } });
        if (!user) {
            throw new AppError('INVALID_VERIFY', 'User not found', 400);
        }

        const now = new Date();
        await prisma.$transaction([
            prisma.user.update({
                where: { id: user.id },
                data: {
                    emailVerifiedAt: user.emailVerifiedAt ?? now,
                },
            }),
            prisma.emailVerificationToken.update({
                where: { id: record.id },
                data: { usedAt: now },
            }),
            prisma.emailVerificationToken.updateMany({
                where: {
                    userId: user.id,
                    usedAt: null,
                    NOT: { id: record.id },
                },
                data: { usedAt: now },
            }),
        ]);

        return { ok: true };
    },
};
