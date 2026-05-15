import { Response } from 'express';
import prisma from '../../../lib/prisma';
import { env } from '../../config/env';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { getMetricsSnapshot } from '../../shared/metrics';
import { planOverrideSchema } from './admin.schemas';

const ensureAdmin = async (userId: string) => {
    if (!env.adminEmails.length) {
        throw new AppError('FORBIDDEN', 'Admin override is not configured.', 403);
    }

    const actor = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
    });

    if (!actor) {
        throw new AppError('UNAUTHORIZED', 'User not found.', 401);
    }

    const email = actor.email.toLowerCase();
    if (!env.adminEmails.includes(email)) {
        throw new AppError('FORBIDDEN', 'Admin access required.', 403);
    }
};

export const overrideUserPlan = asyncHandler(async (req: AuthRequest, res: Response) => {
    const actorId = req.user?.sub;
    if (!actorId) {
        throw new AppError('UNAUTHORIZED', 'Missing user context.', 401);
    }

    await ensureAdmin(actorId);

    const payload = planOverrideSchema.parse(req.body);
    const userId = req.params.userId;

    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
        throw new AppError('NOT_FOUND', 'User not found.', 404);
    }

    const data = {
        planTier: payload.planTier,
        subscriptionActive: payload.subscriptionActive,
        ...(payload.emailVerified === undefined
            ? {}
            : { emailVerifiedAt: payload.emailVerified ? new Date() : null }),
    };

    const updated = await prisma.user.update({
        where: { id: userId },
        data,
    });

    res.status(200).json({
        user: {
            id: updated.id,
            email: updated.email,
            planTier: updated.planTier,
            subscriptionActive: updated.subscriptionActive,
            emailVerified: Boolean(updated.emailVerifiedAt),
        },
    });
});

export const getMetrics = asyncHandler(async (req: AuthRequest, res: Response) => {
    const actorId = req.user?.sub;
    if (!actorId) {
        throw new AppError('UNAUTHORIZED', 'Missing user context.', 401);
    }

    await ensureAdmin(actorId);

    const limitRaw = req.query.limit;
    const limitValue = typeof limitRaw === 'string' ? Number(limitRaw) : undefined;
    const limit =
        limitValue !== undefined && Number.isFinite(limitValue)
            ? Math.min(Math.max(limitValue, 1), 200)
            : undefined;

    res.status(200).json({ metrics: getMetricsSnapshot(limit) });
});
