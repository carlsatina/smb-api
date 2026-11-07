import { Response } from 'express';
import prisma from '../../../lib/prisma';
import { env } from '../../config/env';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { sendBillingEmail } from '../../shared/email';
import { AppError } from '../../shared/errors';
import { getMetricsSnapshot } from '../../shared/metrics';
import { BillingDiscountType, Prisma } from '@prisma/client';
import {
    billingMonthRange,
    BillingLine,
    currentBillingMonth,
    PricedStatement,
    pricingSummary,
} from '../../config/billing';
import { findOverdueByOwner, isMonthEnded } from '../../shared/billingStatus';
import { adminRepository } from './admin.repository';
import {
    billingPaymentSchema,
    ownerDiscountSchema,
    ownerSuspensionSchema,
    sendBillingSchema,
    storeExemptionSchema,
    toggleSuperAdminSchema,
} from './admin.schemas';

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
              subtotal: Number(statement.subtotal),
              discountAmount: Number(statement.discountAmount),
              discountNote: statement.discountNote,
              amount: Number(statement.amount),
              sentAt: statement.sentAt,
              sentToEmail: statement.sentToEmail,
              sentByEmail: statement.sentBy?.email ?? null,
              sendCount: statement.sendCount,
              paidAt: statement.paidAt,
              paymentNote: statement.paymentNote,
          }
        : null;

type OwnerRecord = {
    id: string;
    email: string;
    fullName: string | null;
    billingDiscountType: BillingDiscountType | null;
    billingDiscountValue: Prisma.Decimal | null;
    billingDiscountEndsAt: Date | null;
    billingDiscountNote: string | null;
    billingSuspendedAt: Date | null;
    billingSuspendedReason: string | null;
};

// The discount as configured (it may not apply to the month being viewed).
const serializeOwner = (owner: OwnerRecord) => ({
    id: owner.id,
    email: owner.email,
    fullName: owner.fullName,
    discount:
        owner.billingDiscountType && owner.billingDiscountValue !== null
            ? {
                  type: owner.billingDiscountType,
                  value: Number(owner.billingDiscountValue),
                  endsAt: owner.billingDiscountEndsAt,
                  note: owner.billingDiscountNote,
              }
            : null,
    suspension: owner.billingSuspendedAt
        ? { suspendedAt: owner.billingSuspendedAt, reason: owner.billingSuspendedReason }
        : null,
});

const periodLabelOf = (month: number, year: number) => `${MONTH_NAMES[month - 1]} ${year}`;

// "Through November 2026" is stored as the start of the following billing month.
const endsAfterMonth = (year?: number | null, month?: number | null) =>
    year && month ? billingMonthRange(year, month).end : null;

export const listBilling = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { month, year } = parseBillingPeriod(req.query);
    const rows = await adminRepository.findBillingOwners(year, month);
    const overdueByOwner = await findOverdueByOwner(rows.map((row) => row.owner.id));
    const monthEnded = isMonthEnded(year, month);
    const owners = rows
        .map((row) => ({
            owner: serializeOwner(row.owner),
            ...row.priced,
            stores: row.stores,
            statement: serializeStatement(row.statement),
            // This month's bill was sent, the month is over, and it's unpaid.
            overdue: Boolean(
                monthEnded && row.statement?.sentAt && !row.statement.paidAt && Number(row.statement.amount) > 0
            ),
            // Every overdue month for this owner, across all months.
            overdueMonths: overdueByOwner.get(row.owner.id) ?? [],
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
// With keepSent, a statement that was already emailed is also kept as-is, so
// recording a payment matches the bill the owner actually received.
// Anything else is re-priced from the owner's current stores and discount.
const resolveStatement = async (ownerId: string, year: number, month: number, keepSent = false) => {
    const [existing, live] = await Promise.all([
        adminRepository.findBillingStatement(ownerId, year, month),
        adminRepository.priceOwnerForMonth(ownerId, year, month),
    ]);
    if (!live) {
        throw new AppError('NOT_FOUND', 'Owner not found.', 404);
    }
    if (existing?.paidAt || (keepSent && existing?.sentAt)) {
        const priced: PricedStatement = {
            lines: existing.lines as unknown as BillingLine[],
            subtotal: Number(existing.subtotal),
            discountAmount: Number(existing.discountAmount),
            discountNote: existing.discountNote,
            amount: Number(existing.amount),
        };
        return { owner: live.owner, priced, frozen: true };
    }
    return { owner: live.owner, priced: live.priced, frozen: false };
};

const assertBillable = (priced: PricedStatement) => {
    if (priced.lines.length === 0) {
        throw new AppError('NOTHING_TO_BILL', 'This owner had no stores in that month.', 400);
    }
    if (priced.amount <= 0) {
        throw new AppError('NOTHING_TO_BILL', 'Nothing is due: every store is free or fully discounted.', 400);
    }
};

export const sendBillingNotice = asyncHandler(async (req: AuthRequest, res: Response) => {
    const ownerId = req.params.ownerId;
    const payload = sendBillingSchema.parse(req.body);

    const { owner, priced } = await resolveStatement(ownerId, payload.year, payload.month);
    assertBillable(priced);

    const result = await sendBillingEmail({
        to: owner.email,
        ownerName: owner.fullName,
        periodLabel: periodLabelOf(payload.month, payload.year),
        lines: priced.lines,
        subtotal: priced.subtotal,
        discountAmount: priced.discountAmount,
        discountNote: priced.discountNote,
        amount: priced.amount,
        appLink: env.appBaseUrl,
    });

    if (!result.sent) {
        res.status(200).json({ sent: false, message: 'Email could not be sent. Check email configuration.' });
        return;
    }

    const statement = await adminRepository.upsertBillingStatement(ownerId, payload.year, payload.month, {
        priced,
        sent: { sentToEmail: owner.email, sentById: req.user!.sub },
    });

    res.status(200).json({ sent: true, statement: serializeStatement(statement) });
});

export const setBillingPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
    const ownerId = req.params.ownerId;
    const payload = billingPaymentSchema.parse(req.body);

    if (payload.paid) {
        const { priced, frozen } = await resolveStatement(ownerId, payload.year, payload.month, true);
        assertBillable(priced);
        const statement = await adminRepository.upsertBillingStatement(ownerId, payload.year, payload.month, {
            ...(frozen ? {} : { priced }),
            paid: { paidAt: new Date(), paymentNote: payload.note ?? null },
        });

        // Paying off the last overdue bill lifts a non-payment suspension.
        let reinstated = false;
        const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { billingSuspendedAt: true } });
        if (owner?.billingSuspendedAt) {
            const stillOverdue = (await findOverdueByOwner([ownerId])).get(ownerId) ?? [];
            if (stillOverdue.length === 0) {
                await adminRepository.updateOwnerSuspension(ownerId, null);
                reinstated = true;
            }
        }
        res.status(200).json({ statement: serializeStatement(statement), reinstated });
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

export const setOwnerDiscount = asyncHandler(async (req: AuthRequest, res: Response) => {
    const ownerId = req.params.ownerId;
    const { discount } = ownerDiscountSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } });
    if (!existing) {
        throw new AppError('NOT_FOUND', 'Owner not found.', 404);
    }

    const owner = await adminRepository.updateOwnerDiscount(
        ownerId,
        discount
            ? {
                  type: discount.type,
                  value: discount.value,
                  endsAt: endsAfterMonth(discount.throughYear, discount.throughMonth),
                  note: discount.note || null,
              }
            : null
    );
    res.status(200).json({ owner: serializeOwner(owner) });
});

export const setOwnerSuspension = asyncHandler(async (req: AuthRequest, res: Response) => {
    const ownerId = req.params.ownerId;
    const payload = ownerSuspensionSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, isSuperAdmin: true } });
    if (!existing) {
        throw new AppError('NOT_FOUND', 'Owner not found.', 404);
    }
    if (existing.isSuperAdmin && payload.suspended) {
        throw new AppError('FORBIDDEN', 'Platform admins cannot be suspended for billing.', 403);
    }

    const owner = await adminRepository.updateOwnerSuspension(
        ownerId,
        payload.suspended ? { reason: payload.reason || null } : null
    );
    res.status(200).json({ owner: serializeOwner(owner) });
});

export const setStoreExemption = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const payload = storeExemptionSchema.parse(req.body);

    const existing = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
    if (!existing) {
        throw new AppError('NOT_FOUND', 'Store not found.', 404);
    }

    const store = await adminRepository.updateStoreExemption(
        storeId,
        payload.exempt
            ? { endsAt: endsAfterMonth(payload.throughYear, payload.throughMonth), note: payload.note || null }
            : null
    );
    res.status(200).json({
        store: {
            id: store.id,
            name: store.name,
            storeType: store.storeType,
            billingExempt: store.billingExempt,
            billingExemptEndsAt: store.billingExemptEndsAt,
            billingExemptNote: store.billingExemptNote,
        },
    });
});

export const getStats = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { year, month } = currentBillingMonth();
    const [base, billing] = await Promise.all([
        adminRepository.getPlatformStats(),
        adminRepository.findBillingOwners(year, month),
    ]);

    // A paid statement's snapshot is what was collected; otherwise use live pricing.
    const amountFor = (row: (typeof billing)[number]) =>
        row.statement?.paidAt ? Number(row.statement.amount) : row.priced.amount;
    const billable = billing.filter((row) => amountFor(row) > 0);

    res.status(200).json({
        stats: {
            ...base,
            billing: {
                month,
                year,
                billableOwners: billable.length,
                billableStores: billing.reduce(
                    (total, row) => total + row.priced.lines.filter((line) => !line.exempt).length,
                    0
                ),
                freeStores: billing.reduce(
                    (total, row) => total + row.priced.lines.filter((line) => line.exempt).length,
                    0
                ),
                expectedRevenue: billable.reduce((total, row) => total + amountFor(row), 0),
                collectedRevenue: billable
                    .filter((row) => row.statement?.paidAt)
                    .reduce((total, row) => total + amountFor(row), 0),
                paidOwners: billable.filter((row) => row.statement?.paidAt).length,
                suspendedOwners: billing.filter((row) => row.owner.billingSuspendedAt).length,
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
