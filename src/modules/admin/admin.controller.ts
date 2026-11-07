import { Response } from 'express';
import prisma from '../../../lib/prisma';
import { env } from '../../config/env';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { sendBillingEmail } from '../../shared/email';
import { AppError } from '../../shared/errors';
import { getMetricsSnapshot } from '../../shared/metrics';
import { BillingLine, buildBillingLines, currentBillingMonth, pricingSummary } from '../../config/billing';
import { adminRepository } from './admin.repository';
import { billingPaymentSchema, sendBillingSchema, toggleSuperAdminSchema } from './admin.schemas';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export const listUsers = asyncHandler(async (req: AuthRequest, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const result = await adminRepository.findAllUsers(page);
    const users = result.users.map(({ _count, emailVerifiedAt, ...u }) => ({
        ...u,
        emailVerified: Boolean(emailVerifiedAt),
        ownedStores: _count.memberships,
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

const parseBillingPeriod = (query: AuthRequest['query']) => {
    const current = currentBillingMonth();
    const monthRaw = Number(query.month);
    const yearRaw = Number(query.year);
    return {
        month: monthRaw >= 1 && monthRaw <= 12 ? monthRaw : current.month,
        year: yearRaw >= 2020 && yearRaw <= 2100 ? yearRaw : current.year,
    };
};

type StatementRecord = NonNullable<Awaited<ReturnType<typeof adminRepository.findBillingStatement>>> & {
    sentBy?: { email: string } | null;
};

const serializeStatement = (statement: StatementRecord | null) =>
    statement
        ? {
              id: statement.id,
              storeCount: statement.storeCount,
              lines: statement.lines as unknown as BillingLine[],
              amount: Number(statement.amount),
              sentAt: statement.sentAt,
              sentToEmail: statement.sentToEmail,
              sentByEmail: statement.sentBy?.email ?? null,
              sendCount: statement.sendCount,
              paidAt: statement.paidAt,
              paymentNote: statement.paymentNote,
          }
        : null;

const periodLabelOf = (month: number, year: number) => `${MONTH_NAMES[month - 1]} ${year}`;

export const listBilling = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { month, year } = parseBillingPeriod(req.query);
    const rows = await adminRepository.findBillingOwners(year, month);
    const owners = rows
        .map((row) => ({
            owner: row.owner,
            lines: row.lines,
            amount: row.amount,
            statement: serializeStatement(row.statement),
        }))
        .sort((a, b) => b.lines.length - a.lines.length || a.owner.email.localeCompare(b.owner.email));
    res.status(200).json({ owners, month, year, pricing: pricingSummary() });
});

export const listBillingHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
    const monthRaw = Number(req.query.month);
    const yearRaw = Number(req.query.year);
    const month = monthRaw >= 1 && monthRaw <= 12 ? monthRaw : undefined;
    const year = yearRaw >= 2020 ? yearRaw : undefined;
    const filterByMonth = Boolean(month && year);

    const rows = await adminRepository.findBillingHistory(
        filterByMonth ? year : undefined,
        filterByMonth ? month : undefined
    );

    const entries = rows.map((r) => ({
        ...serializeStatement(r)!,
        year: r.year,
        month: r.month,
        ownerEmail: r.owner.email,
        ownerName: r.owner.fullName,
    }));

    res.status(200).json({ entries });
});

// Paid statements are frozen: what the owner paid for stays what we show.
// Anything else is re-priced from the owner's current stores.
const resolveStatementLines = async (ownerId: string, year: number, month: number) => {
    const existing = await adminRepository.findBillingStatement(ownerId, year, month);
    if (existing?.paidAt) {
        return { lines: existing.lines as unknown as BillingLine[], frozen: true };
    }
    const stores = await adminRepository.findOwnerBillableStores(ownerId, year, month);
    return { lines: buildBillingLines(stores), frozen: false };
};

export const sendBillingNotice = asyncHandler(async (req: AuthRequest, res: Response) => {
    const ownerId = req.params.ownerId;
    const payload = sendBillingSchema.parse(req.body);

    const owner = await prisma.user.findUnique({
        where: { id: ownerId },
        select: { id: true, email: true, fullName: true },
    });
    if (!owner) {
        throw new AppError('NOT_FOUND', 'Owner not found.', 404);
    }

    const { lines } = await resolveStatementLines(ownerId, payload.year, payload.month);
    if (lines.length === 0) {
        throw new AppError('NOTHING_TO_BILL', 'This owner had no stores in that month.', 400);
    }
    const amount = lines.reduce((total, line) => total + line.fee, 0);

    const result = await sendBillingEmail({
        to: owner.email,
        ownerName: owner.fullName,
        periodLabel: periodLabelOf(payload.month, payload.year),
        lines,
        amount,
        appLink: env.appBaseUrl,
    });

    if (!result.sent) {
        res.status(200).json({ sent: false, message: 'Email could not be sent. Check email configuration.' });
        return;
    }

    const statement = await adminRepository.upsertBillingStatement(ownerId, payload.year, payload.month, {
        lines,
        sent: { sentToEmail: owner.email, sentById: req.user!.sub },
    });

    res.status(200).json({ sent: true, statement: serializeStatement(statement) });
});

export const setBillingPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
    const ownerId = req.params.ownerId;
    const payload = billingPaymentSchema.parse(req.body);

    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } });
    if (!owner) {
        throw new AppError('NOT_FOUND', 'Owner not found.', 404);
    }

    if (payload.paid) {
        const { lines, frozen } = await resolveStatementLines(ownerId, payload.year, payload.month);
        if (lines.length === 0) {
            throw new AppError('NOTHING_TO_BILL', 'This owner had no stores in that month.', 400);
        }
        const statement = await adminRepository.upsertBillingStatement(ownerId, payload.year, payload.month, {
            ...(frozen ? {} : { lines }),
            paid: { paidAt: new Date(), paymentNote: payload.note ?? null },
        });
        res.status(200).json({ statement: serializeStatement(statement) });
        return;
    }

    const existing = await adminRepository.findBillingStatement(ownerId, payload.year, payload.month);
    if (!existing) {
        res.status(200).json({ statement: null });
        return;
    }
    const statement = await adminRepository.upsertBillingStatement(ownerId, payload.year, payload.month, {
        paid: { paidAt: null, paymentNote: null },
    });
    res.status(200).json({ statement: serializeStatement(statement) });
});

export const getStats = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { year, month } = currentBillingMonth();
    const [base, billing] = await Promise.all([
        adminRepository.getPlatformStats(),
        adminRepository.findBillingOwners(year, month),
    ]);

    // A paid statement's snapshot is what was collected; otherwise use live pricing.
    const amountFor = (row: (typeof billing)[number]) =>
        row.statement?.paidAt ? Number(row.statement.amount) : row.amount;
    const billable = billing.filter((row) => row.lines.length > 0 || row.statement?.paidAt);

    res.status(200).json({
        stats: {
            ...base,
            billing: {
                month,
                year,
                billableOwners: billable.length,
                billableStores: billing.reduce((total, row) => total + row.lines.length, 0),
                expectedRevenue: billable.reduce((total, row) => total + amountFor(row), 0),
                collectedRevenue: billable
                    .filter((row) => row.statement?.paidAt)
                    .reduce((total, row) => total + amountFor(row), 0),
                paidOwners: billable.filter((row) => row.statement?.paidAt).length,
                pricing: pricingSummary(),
            },
        },
    });
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
