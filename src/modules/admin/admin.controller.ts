import { Response } from 'express';
import prisma from '../../../lib/prisma';
import { env } from '../../config/env';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { sendBillingEmail } from '../../shared/email';
import { AppError } from '../../shared/errors';
import { getMetricsSnapshot } from '../../shared/metrics';
import { adminRepository } from './admin.repository';
import { grantPlanSchema, planOverrideSchema, sendBillingSchema, toggleBillingModeSchema, toggleSuperAdminSchema } from './admin.schemas';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

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
    const now = new Date();
    const month = Math.min(12, Math.max(1, Number(req.query.month) || now.getMonth() + 1));
    const year = Math.max(2020, Number(req.query.year) || now.getFullYear());
    const result = await adminRepository.findAllStores(page, month, year);
    const stores = result.stores.map((s) => ({
        id: s.id,
        name: s.name,
        storeType: s.storeType,
        currency: s.currency,
        createdAt: s.createdAt,
        owner: s.members[0]?.user ?? null,
        totalSales: s._count.sales,
        salesThisMonth: s.salesThisMonth,
    }));
    res.status(200).json({ stores, total: result.total, page: result.page, pageSize: result.pageSize, month, year });
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

export const toggleBillingMode = asyncHandler(async (req: AuthRequest, res: Response) => {
    const payload = toggleBillingModeSchema.parse(req.body);
    const userId = req.params.userId;

    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
        throw new AppError('NOT_FOUND', 'User not found.', 404);
    }

    const updated = await adminRepository.updateUserBillingMode(userId, payload.payPerReceipt);
    res.status(200).json({
        user: {
            id: updated.id,
            email: updated.email,
            payPerReceipt: updated.payPerReceipt,
        },
    });
});

export const listBilling = asyncHandler(async (req: AuthRequest, res: Response) => {
    const now = new Date();
    const month = Math.min(12, Math.max(1, Number(req.query.month) || now.getMonth() + 1));
    const year = Math.max(2020, Number(req.query.year) || now.getFullYear());
    const result = await adminRepository.findBillingStores(month, year);
    const stores = result.map((s) => ({
        id: s.id,
        name: s.name,
        currency: s.currency,
        owner: s.owner,
        receiptCount: s.receiptCount,
        lastBilledAt: s.lastNotice?.sentAt ?? null,
        lastBilledAmount: s.lastNotice ? Number(s.lastNotice.amount) : null,
        lastBilledReceipts: s.lastNotice?.receiptCount ?? null,
    }));
    res.status(200).json({ stores, month, year });
});

export const listBillingHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
    const monthRaw = Number(req.query.month);
    const yearRaw = Number(req.query.year);
    const month = monthRaw >= 1 && monthRaw <= 12 ? monthRaw : undefined;
    const year = yearRaw >= 2020 ? yearRaw : undefined;
    const filterByMonth = Boolean(month && year);

    const rows = await adminRepository.findBillingHistory(
        filterByMonth ? month : undefined,
        filterByMonth ? year : undefined
    );

    const entries = rows.map((r) => ({
        id: r.id,
        storeName: r.store.name,
        sentToEmail: r.sentToEmail,
        sentByEmail: r.sentBy?.email ?? null,
        year: r.year,
        month: r.month,
        receiptCount: r.receiptCount,
        feeRate: Number(r.feeRate),
        amount: Number(r.amount),
        sentAt: r.sentAt,
    }));

    res.status(200).json({ entries });
});

export const sendBillingNotice = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const payload = sendBillingSchema.parse(req.body);

    const store = await adminRepository.findStoreWithOwner(storeId);
    if (!store) {
        throw new AppError('NOT_FOUND', 'Store not found.', 404);
    }
    const owner = store.members[0]?.user;
    if (!owner?.email) {
        throw new AppError('NO_OWNER', 'This store has no owner email to bill.', 400);
    }

    const receiptCount = await adminRepository.getStoreReceiptCount(storeId, payload.month, payload.year);
    const amount = Math.round(receiptCount * payload.feeRate * 100) / 100;
    const periodLabel = `${MONTH_NAMES[payload.month - 1]} ${payload.year}`;

    const result = await sendBillingEmail({
        to: owner.email,
        storeName: store.name,
        periodLabel,
        receiptCount,
        feeRate: payload.feeRate,
        amount,
        appLink: env.appBaseUrl,
    });

    if (!result.sent) {
        res.status(200).json({ sent: false, message: 'Email could not be sent. Check email configuration.' });
        return;
    }

    const notice = await adminRepository.recordBillingNotice({
        storeId,
        year: payload.year,
        month: payload.month,
        receiptCount,
        feeRate: payload.feeRate,
        amount,
        sentToEmail: owner.email,
        sentById: req.user!.sub,
    });

    res.status(200).json({
        sent: true,
        notice: {
            sentAt: notice.sentAt,
            amount: Number(notice.amount),
            receiptCount: notice.receiptCount,
            sentToEmail: notice.sentToEmail,
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

export const getUserFeatures = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId } = req.params;
    const features = await prisma.userFeature.findMany({
        where: { userId },
        select: { feature: true, grantedAt: true, expiresAt: true, grantedBy: { select: { email: true } } },
    });
    res.status(200).json({ features });
});

export const grantUserFeature = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId } = req.params;
    const grantedById = req.user?.sub;
    if (!grantedById) throw new AppError('UNAUTHORIZED', 'Authentication required', 401);

    const { feature, expiresAt } = req.body as { feature: string; expiresAt?: string };
    if (!feature) throw new AppError('BAD_REQUEST', 'feature is required', 400);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('NOT_FOUND', 'User not found', 404);

    const grant = await prisma.userFeature.upsert({
        where: { userId_feature: { userId, feature } },
        create: { userId, feature, grantedById, expiresAt: expiresAt ? new Date(expiresAt) : null },
        update: { grantedById, expiresAt: expiresAt ? new Date(expiresAt) : null, grantedAt: new Date() },
    });
    res.status(200).json({ grant });
});

export const revokeUserFeature = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId, feature } = req.params;

    await prisma.userFeature.deleteMany({ where: { userId, feature } });
    res.status(204).send();
});
