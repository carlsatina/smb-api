import { Response } from 'express';
import prisma from '../../../lib/prisma';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { getMetricsSnapshot } from '../../shared/metrics';
import { adminRepository } from './admin.repository';
import { grantPlanSchema, planOverrideSchema, toggleSuperAdminSchema } from './admin.schemas';

export const listUsers = asyncHandler(async (req: AuthRequest, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const result = await adminRepository.findAllUsers(page);
    const users = result.users.map((u) => ({
        ...u,
        emailVerified: Boolean(u.emailVerifiedAt),
        emailVerifiedAt: undefined,
    }));
    res.status(200).json({ users, total: result.total, page: result.page, pageSize: result.pageSize });
});

export const listStores = asyncHandler(async (req: AuthRequest, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const result = await adminRepository.findAllStores(page);
    const stores = result.stores.map((s) => ({
        id: s.id,
        name: s.name,
        currency: s.currency,
        createdAt: s.createdAt,
        owner: s.members[0]?.user ?? null,
    }));
    res.status(200).json({ stores, total: result.total, page: result.page, pageSize: result.pageSize });
});

export const overrideUserPlan = asyncHandler(async (req: AuthRequest, res: Response) => {
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
            : { emailVerifiedAt: payload.emailVerified ? (existing.emailVerifiedAt ?? new Date()) : null }),
    };

    const updated = await adminRepository.updateUserPlan(userId, data);
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

export const grantUserPlan = asyncHandler(async (req: AuthRequest, res: Response) => {
    const payload = grantPlanSchema.parse(req.body);
    const userId = req.params.userId;

    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
        throw new AppError('NOT_FOUND', 'User not found.', 404);
    }

    const grantedUntil = payload.grantedUntil ? new Date(payload.grantedUntil) : null;
    const updated = await adminRepository.updateUserGrant(userId, payload.grantedPlan, grantedUntil);

    res.status(200).json({
        user: {
            id: updated.id,
            email: updated.email,
            planTier: updated.planTier,
            grantedPlan: updated.grantedPlan,
            grantedUntil: updated.grantedUntil,
        },
    });
});

export const revokeUserGrant = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.params.userId;

    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
        throw new AppError('NOT_FOUND', 'User not found.', 404);
    }

    const updated = await adminRepository.revokeUserGrant(userId);
    res.status(200).json({
        user: {
            id: updated.id,
            email: updated.email,
            planTier: updated.planTier,
            grantedPlan: updated.grantedPlan,
            grantedUntil: updated.grantedUntil,
        },
    });
});

export const toggleSuperAdmin = asyncHandler(async (req: AuthRequest, res: Response) => {
    const payload = toggleSuperAdminSchema.parse(req.body);
    const userId = req.params.userId;
    const actorId = req.user!.sub;

    if (userId === actorId) {
        throw new AppError('FORBIDDEN', 'Cannot modify your own super admin status.', 403);
    }

    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
        throw new AppError('NOT_FOUND', 'User not found.', 404);
    }

    const updated = await adminRepository.updateUserSuperAdmin(userId, payload.isSuperAdmin);
    res.status(200).json({
        user: {
            id: updated.id,
            email: updated.email,
            isSuperAdmin: updated.isSuperAdmin,
        },
    });
});

export const getStats = asyncHandler(async (req: AuthRequest, res: Response) => {
    const stats = await adminRepository.getPlatformStats();
    res.status(200).json({ stats });
});

export const getMetrics = asyncHandler(async (req: AuthRequest, res: Response) => {
    const limitRaw = req.query.limit;
    const limitValue = typeof limitRaw === 'string' ? Number(limitRaw) : undefined;
    const limit =
        limitValue !== undefined && Number.isFinite(limitValue)
            ? Math.min(Math.max(limitValue, 1), 200)
            : undefined;

    res.status(200).json({ metrics: getMetricsSnapshot(limit) });
});
