import { BillingDiscountType, Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';
import {
    billingMonthRange,
    buildBillingLines,
    isActiveForMonth,
    ownerDiscountForMonth,
    PricedStatement,
    priceStatement,
} from '../../config/billing';

const PAGE_SIZE = 50;

const billingOwnerSelect = {
    id: true,
    email: true,
    fullName: true,
    billingDiscountType: true,
    billingDiscountValue: true,
    billingDiscountEndsAt: true,
    billingDiscountNote: true,
} as const;

const billableStoreSelect = {
    id: true,
    name: true,
    storeType: true,
    createdAt: true,
    billingExempt: true,
    billingExemptEndsAt: true,
    billingExemptNote: true,
} as const;

type BillableStoreRow = {
    id: string;
    name: string;
    storeType: string;
    createdAt: Date;
    billingExempt: boolean;
    billingExemptEndsAt: Date | null;
    billingExemptNote: string | null;
};

type BillingOwnerRow = {
    billingDiscountType: BillingDiscountType | null;
    billingDiscountValue: Prisma.Decimal | null;
    billingDiscountEndsAt: Date | null;
    billingDiscountNote: string | null;
};

const priceOwnerMonth = (stores: BillableStoreRow[], owner: BillingOwnerRow, monthStart: Date) =>
    priceStatement(
        buildBillingLines(
            stores.map((store) => ({
                id: store.id,
                name: store.name,
                storeType: store.storeType,
                createdAt: store.createdAt,
                exempt: store.billingExempt && isActiveForMonth(store.billingExemptEndsAt, monthStart),
            }))
        ),
        ownerDiscountForMonth(owner, monthStart)
    );

const serializeStoreBilling = (store: BillableStoreRow) => ({
    id: store.id,
    name: store.name,
    storeType: store.storeType,
    billingExempt: store.billingExempt,
    billingExemptEndsAt: store.billingExemptEndsAt,
    billingExemptNote: store.billingExemptNote,
});

export const adminRepository = {
    findAllUsers: async (page: number) => {
        const skip = (page - 1) * PAGE_SIZE;
        const [users, total] = await Promise.all([
            prisma.user.findMany({
                skip,
                take: PAGE_SIZE,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    email: true,
                    fullName: true,
                    isSuperAdmin: true,
                    emailVerifiedAt: true,
                    createdAt: true,
                    _count: {
                        select: {
                            memberships: {
                                where: { role: 'OWNER', deletedAt: null, store: { deletedAt: null } },
                            },
                        },
                    },
                },
            }),
            prisma.user.count(),
        ]);
        return { users, total, page, pageSize: PAGE_SIZE };
    },

    findAllStores: async (page: number, month: number, year: number) => {
        const skip = (page - 1) * PAGE_SIZE;
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 1); // exclusive upper bound

        const [stores, total] = await Promise.all([
            prisma.store.findMany({
                skip,
                take: PAGE_SIZE,
                where: { deletedAt: null },
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    name: true,
                    storeType: true,
                    currency: true,
                    createdAt: true,
                    members: {
                        where: { role: 'OWNER', deletedAt: null },
                        orderBy: { createdAt: 'asc' },
                        take: 1,
                        select: {
                            user: {
                                select: {
                                    id: true,
                                    email: true,
                                },
                            },
                        },
                    },
                    _count: {
                        select: {
                            sales: { where: { status: 'FINALIZED', deletedAt: null } },
                        },
                    },
                },
            }),
            prisma.store.count({ where: { deletedAt: null } }),
        ]);

        const monthlySales = await prisma.sale.groupBy({
            by: ['storeId'],
            where: {
                storeId: { in: stores.map((s) => s.id) },
                status: 'FINALIZED',
                deletedAt: null,
                createdAt: { gte: monthStart, lt: monthEnd },
            },
            _count: { _all: true },
        });
        const monthlyMap = new Map(monthlySales.map((r) => [r.storeId, r._count._all]));

        const enriched = stores.map((s) => ({
            ...s,
            salesThisMonth: monthlyMap.get(s.id) ?? 0,
        }));

        return { stores: enriched, total, page, pageSize: PAGE_SIZE, month, year };
    },

    updateUserSuperAdmin: async (userId: string, isSuperAdmin: boolean) => {
        return prisma.user.update({ where: { id: userId }, data: { isSuperAdmin } });
    },

    // Every owner with at least one store that existed during the month, with
    // their stores priced oldest-first (free stores excluded from ranking) and
    // their discount applied, alongside any statement already on file.
    findBillingOwners: async (year: number, month: number) => {
        const { start, end } = billingMonthRange(year, month);

        const [stores, statements] = await Promise.all([
            prisma.store.findMany({
                where: {
                    createdAt: { lt: end },
                    OR: [{ deletedAt: null }, { deletedAt: { gte: start } }],
                },
                select: {
                    ...billableStoreSelect,
                    members: {
                        where: { role: 'OWNER', deletedAt: null },
                        orderBy: { createdAt: 'asc' },
                        take: 1,
                        select: { user: { select: billingOwnerSelect } },
                    },
                },
            }),
            prisma.billingStatement.findMany({
                where: { year, month },
                include: {
                    owner: { select: billingOwnerSelect },
                    sentBy: { select: { email: true } },
                },
            }),
        ]);

        type Owner = (typeof stores)[number]['members'][number]['user'];
        const byOwner = new Map<string, { owner: Owner; stores: typeof stores }>();
        for (const store of stores) {
            const owner = store.members[0]?.user;
            if (!owner) continue;
            const entry = byOwner.get(owner.id) ?? { owner, stores: [] };
            entry.stores.push(store);
            byOwner.set(owner.id, entry);
        }

        const statementByOwner = new Map(statements.map((st) => [st.ownerId, st]));
        const ownerIds = new Set([...byOwner.keys(), ...statementByOwner.keys()]);

        return [...ownerIds].map((ownerId) => {
            const entry = byOwner.get(ownerId);
            const owner = entry?.owner ?? statementByOwner.get(ownerId)!.owner;
            return {
                owner,
                priced: priceOwnerMonth(entry?.stores ?? [], owner, start),
                stores: (entry?.stores ?? []).map(serializeStoreBilling),
                statement: statementByOwner.get(ownerId) ?? null,
            };
        });
    },

    priceOwnerForMonth: async (ownerId: string, year: number, month: number) => {
        const { start, end } = billingMonthRange(year, month);
        const [owner, stores] = await Promise.all([
            prisma.user.findUnique({ where: { id: ownerId }, select: billingOwnerSelect }),
            prisma.store.findMany({
                where: {
                    createdAt: { lt: end },
                    OR: [{ deletedAt: null }, { deletedAt: { gte: start } }],
                    members: { some: { userId: ownerId, role: 'OWNER', deletedAt: null } },
                },
                select: {
                    ...billableStoreSelect,
                    members: {
                        where: { role: 'OWNER', deletedAt: null },
                        orderBy: { createdAt: 'asc' },
                        take: 1,
                        select: { userId: true },
                    },
                },
            }),
        ]);
        if (!owner) return null;
        // Only stores where this user is the billed (earliest) owner.
        const billed = stores.filter((s) => s.members[0]?.userId === ownerId);
        return { owner, priced: priceOwnerMonth(billed, owner, start) };
    },

    updateOwnerDiscount: async (
        ownerId: string,
        discount: { type: BillingDiscountType; value: number; endsAt: Date | null; note: string | null } | null
    ) => {
        return prisma.user.update({
            where: { id: ownerId },
            data: {
                billingDiscountType: discount?.type ?? null,
                billingDiscountValue: discount?.value ?? null,
                billingDiscountEndsAt: discount?.endsAt ?? null,
                billingDiscountNote: discount?.note ?? null,
            },
            select: billingOwnerSelect,
        });
    },

    updateStoreExemption: async (
        storeId: string,
        exemption: { endsAt: Date | null; note: string | null } | null
    ) => {
        return prisma.store.update({
            where: { id: storeId },
            data: {
                billingExempt: Boolean(exemption),
                billingExemptEndsAt: exemption?.endsAt ?? null,
                billingExemptNote: exemption?.note ?? null,
            },
            select: billableStoreSelect,
        });
    },

    findBillingStatement: async (ownerId: string, year: number, month: number) => {
        return prisma.billingStatement.findUnique({
            where: { ownerId_year_month: { ownerId, year, month } },
        });
    },

    upsertBillingStatement: async (
        ownerId: string,
        year: number,
        month: number,
        data: {
            priced?: PricedStatement;
            sent?: { sentToEmail: string; sentById: string };
            paid?: { paidAt: Date | null; paymentNote: string | null };
        }
    ) => {
        const snapshot = data.priced
            ? {
                  lines: data.priced.lines as unknown as Prisma.InputJsonValue,
                  storeCount: data.priced.lines.length,
                  subtotal: data.priced.subtotal,
                  discountAmount: data.priced.discountAmount,
                  discountNote: data.priced.discountNote,
                  amount: data.priced.amount,
              }
            : {};
        const sent = data.sent
            ? { sentAt: new Date(), sentToEmail: data.sent.sentToEmail, sentById: data.sent.sentById }
            : {};
        const paid = data.paid ?? {};

        return prisma.billingStatement.upsert({
            where: { ownerId_year_month: { ownerId, year, month } },
            create: {
                ownerId,
                year,
                month,
                lines: [],
                storeCount: 0,
                amount: 0,
                ...snapshot,
                ...sent,
                ...(data.sent ? { sendCount: 1 } : {}),
                ...paid,
            },
            update: {
                ...snapshot,
                ...sent,
                ...(data.sent ? { sendCount: { increment: 1 } } : {}),
                ...paid,
            },
            include: { sentBy: { select: { email: true } } },
        });
    },

    findBillingHistory: async (year?: number, month?: number) => {
        return prisma.billingStatement.findMany({
            where: {
                ...(year && month ? { year, month } : {}),
                OR: [{ sentAt: { not: null } }, { paidAt: { not: null } }],
            },
            orderBy: [{ year: 'desc' }, { month: 'desc' }, { updatedAt: 'desc' }],
            take: 500,
            include: {
                owner: { select: { email: true, fullName: true } },
                sentBy: { select: { email: true } },
            },
        });
    },

    getPlatformStats: async () => {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const [totalUsers, totalStores, newUsersThisMonth] = await Promise.all([
            prisma.user.count(),
            prisma.store.count({ where: { deletedAt: null } }),
            prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
        ]);

        return { totalUsers, totalStores, newUsersThisMonth };
    },
};
