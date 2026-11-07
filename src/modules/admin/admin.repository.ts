import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { billingMonthRange, BillingLine, buildBillingLines, sumBillingLines } from '../../config/billing';

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
    // their stores priced oldest-first, alongside any statement already on file.
    findBillingOwners: async (year: number, month: number) => {
        const { start, end } = billingMonthRange(year, month);

        const [stores, statements] = await Promise.all([
            prisma.store.findMany({
                where: {
                    createdAt: { lt: end },
                    OR: [{ deletedAt: null }, { deletedAt: { gte: start } }],
                },
                select: {
                    id: true,
                    name: true,
                    storeType: true,
                    createdAt: true,
                    members: {
                        where: { role: 'OWNER', deletedAt: null },
                        orderBy: { createdAt: 'asc' },
                        take: 1,
                        select: { user: { select: { id: true, email: true, fullName: true } } },
                    },
                },
            }),
            prisma.billingStatement.findMany({
                where: { year, month },
                include: {
                    owner: { select: { id: true, email: true, fullName: true } },
                    sentBy: { select: { email: true } },
                },
            }),
        ]);

        type Owner = { id: string; email: string; fullName: string | null };
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
            const statement = statementByOwner.get(ownerId) ?? null;
            const lines = buildBillingLines(entry?.stores ?? []);
            return {
                owner: entry?.owner ?? statement!.owner,
                lines,
                amount: sumBillingLines(lines),
                statement,
            };
        });
    },

    findOwnerBillableStores: async (ownerId: string, year: number, month: number) => {
        const { start, end } = billingMonthRange(year, month);
        const stores = await prisma.store.findMany({
            where: {
                createdAt: { lt: end },
                OR: [{ deletedAt: null }, { deletedAt: { gte: start } }],
                members: { some: { userId: ownerId, role: 'OWNER', deletedAt: null } },
            },
            select: {
                id: true,
                name: true,
                storeType: true,
                createdAt: true,
                members: {
                    where: { role: 'OWNER', deletedAt: null },
                    orderBy: { createdAt: 'asc' },
                    take: 1,
                    select: { userId: true },
                },
            },
        });
        // Only stores where this user is the billed (earliest) owner.
        return stores.filter((s) => s.members[0]?.userId === ownerId);
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
            lines?: BillingLine[];
            sent?: { sentToEmail: string; sentById: string };
            paid?: { paidAt: Date | null; paymentNote: string | null };
        }
    ) => {
        const snapshot = data.lines
            ? {
                  lines: data.lines as unknown as Prisma.InputJsonValue,
                  storeCount: data.lines.length,
                  amount: sumBillingLines(data.lines),
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
