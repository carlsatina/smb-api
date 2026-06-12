import { PlanTier } from '@prisma/client';
import prisma from '../../../lib/prisma';

const PAGE_SIZE = 50;

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
                    planTier: true,
                    grantedPlan: true,
                    grantedUntil: true,
                    subscriptionActive: true,
                    payPerReceipt: true,
                    isSuperAdmin: true,
                    emailVerifiedAt: true,
                    createdAt: true,
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
                        take: 1,
                        select: {
                            user: {
                                select: {
                                    id: true,
                                    email: true,
                                    planTier: true,
                                    grantedPlan: true,
                                    grantedUntil: true,
                                    subscriptionActive: true,
                                    payPerReceipt: true,
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

    updateUserPlan: async (userId: string, data: { planTier: PlanTier; subscriptionActive: boolean; emailVerifiedAt?: Date | null }) => {
        return prisma.user.update({ where: { id: userId }, data });
    },

    updateUserGrant: async (userId: string, grantedPlan: PlanTier, grantedUntil: Date | null) => {
        return prisma.user.update({ where: { id: userId }, data: { grantedPlan, grantedUntil } });
    },

    revokeUserGrant: async (userId: string) => {
        return prisma.user.update({ where: { id: userId }, data: { grantedPlan: null, grantedUntil: null } });
    },

    updateUserSuperAdmin: async (userId: string, isSuperAdmin: boolean) => {
        return prisma.user.update({ where: { id: userId }, data: { isSuperAdmin } });
    },

    updateUserBillingMode: async (userId: string, payPerReceipt: boolean) => {
        return prisma.user.update({ where: { id: userId }, data: { payPerReceipt } });
    },

    findBillingStores: async (month: number, year: number) => {
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 1);

        const stores = await prisma.store.findMany({
            where: {
                deletedAt: null,
                members: { some: { role: 'OWNER', deletedAt: null, user: { payPerReceipt: true } } },
            },
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                currency: true,
                members: {
                    where: { role: 'OWNER', deletedAt: null },
                    take: 1,
                    select: { user: { select: { id: true, email: true } } },
                },
                billingNotices: {
                    where: { year, month },
                    orderBy: { sentAt: 'desc' },
                    take: 1,
                    select: { sentAt: true, amount: true, receiptCount: true, feeRate: true, sentToEmail: true },
                },
            },
        });

        const counts = await prisma.sale.groupBy({
            by: ['storeId'],
            where: {
                storeId: { in: stores.map((s) => s.id) },
                status: 'FINALIZED',
                deletedAt: null,
                createdAt: { gte: monthStart, lt: monthEnd },
            },
            _count: { _all: true },
        });
        const countMap = new Map(counts.map((r) => [r.storeId, r._count._all]));

        return stores.map((s) => ({
            id: s.id,
            name: s.name,
            currency: s.currency,
            owner: s.members[0]?.user ?? null,
            receiptCount: countMap.get(s.id) ?? 0,
            lastNotice: s.billingNotices[0] ?? null,
        }));
    },

    findStoreWithOwner: async (storeId: string) => {
        return prisma.store.findFirst({
            where: { id: storeId, deletedAt: null },
            select: {
                id: true,
                name: true,
                members: {
                    where: { role: 'OWNER', deletedAt: null },
                    take: 1,
                    select: { user: { select: { id: true, email: true, payPerReceipt: true } } },
                },
            },
        });
    },

    getStoreReceiptCount: async (storeId: string, month: number, year: number) => {
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 1);
        return prisma.sale.count({
            where: {
                storeId,
                status: 'FINALIZED',
                deletedAt: null,
                createdAt: { gte: monthStart, lt: monthEnd },
            },
        });
    },

    recordBillingNotice: async (data: {
        storeId: string;
        year: number;
        month: number;
        receiptCount: number;
        feeRate: number;
        amount: number;
        sentToEmail: string;
        sentById: string;
    }) => {
        // Append-only: each send is its own row.
        return prisma.billingNotice.create({ data });
    },

    findBillingHistory: async (month?: number, year?: number) => {
        const where = month && year ? { month, year } : {};
        return prisma.billingNotice.findMany({
            where,
            orderBy: { sentAt: 'desc' },
            take: 500,
            select: {
                id: true,
                year: true,
                month: true,
                receiptCount: true,
                feeRate: true,
                amount: true,
                sentToEmail: true,
                sentAt: true,
                store: { select: { name: true } },
                sentBy: { select: { email: true } },
            },
        });
    },

    getPlatformStats: async () => {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const [
            totalUsers,
            totalStores,
            activeSubscriptions,
            grantedPlans,
            newUsersThisMonth,
            usersByPlan,
        ] = await Promise.all([
            prisma.user.count(),
            prisma.store.count({ where: { deletedAt: null } }),
            prisma.user.count({ where: { subscriptionActive: true } }),
            prisma.user.count({ where: { grantedPlan: { not: null } } }),
            prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
            prisma.user.groupBy({ by: ['planTier'], _count: { _all: true } }),
        ]);

        const planBreakdown = Object.fromEntries(
            usersByPlan.map((row) => [row.planTier, row._count._all])
        ) as Record<string, number>;

        return {
            totalUsers,
            totalStores,
            activeSubscriptions,
            grantedPlans,
            newUsersThisMonth,
            planBreakdown,
        };
    },
};
