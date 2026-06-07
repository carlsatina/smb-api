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
                    isSuperAdmin: true,
                    emailVerifiedAt: true,
                    createdAt: true,
                },
            }),
            prisma.user.count(),
        ]);
        return { users, total, page, pageSize: PAGE_SIZE };
    },

    findAllStores: async (page: number) => {
        const skip = (page - 1) * PAGE_SIZE;
        const [stores, total] = await Promise.all([
            prisma.store.findMany({
                skip,
                take: PAGE_SIZE,
                where: { deletedAt: null },
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    name: true,
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
                                },
                            },
                        },
                    },
                },
            }),
            prisma.store.count({ where: { deletedAt: null } }),
        ]);
        return { stores, total, page, pageSize: PAGE_SIZE };
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
