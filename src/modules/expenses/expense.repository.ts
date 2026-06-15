import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { RESTRICTED_EXPENSE_CATEGORIES } from './expense.constants';

export type ExpenseListFilters = {
    from?: string;
    to?: string;
    category?: string;
    // When true, expenses in RESTRICTED_EXPENSE_CATEGORIES (rent, salaries) are excluded.
    excludeRestricted?: boolean;
};

// Case-insensitive exclusion of the restricted categories.
const restrictedNot = RESTRICTED_EXPENSE_CATEGORIES.map((c) => ({
    category: { equals: c, mode: 'insensitive' as const },
}));

export type ExpenseCreateData = {
    date: Date;
    amount: Prisma.Decimal;
    category: string;
    note: string | null;
    createdById: string;
};

const buildDateFilter = (filters: ExpenseListFilters): Prisma.DateTimeFilter | undefined => {
    const range: Prisma.DateTimeFilter = {};
    if (filters.from) range.gte = new Date(filters.from);
    if (filters.to) range.lte = new Date(filters.to);
    return Object.keys(range).length > 0 ? range : undefined;
};

export const expenseRepository = {
    listByStore: async (storeId: string, filters: ExpenseListFilters = {}) => {
        const dateFilter = buildDateFilter(filters);
        return prisma.expense.findMany({
            where: {
                storeId,
                deletedAt: null,
                ...(dateFilter ? { date: dateFilter } : {}),
                ...(filters.category ? { category: filters.category } : {}),
                ...(filters.excludeRestricted ? { NOT: restrictedNot } : {}),
            },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
            include: { createdBy: { select: { id: true, fullName: true, email: true } } },
        });
    },
    getById: async (storeId: string, expenseId: string) => {
        return prisma.expense.findFirst({
            where: { id: expenseId, storeId, deletedAt: null },
            include: { createdBy: { select: { id: true, fullName: true, email: true } } },
        });
    },
    // Sum of expense amounts grouped by date over a range. Used to derive the
    // daily-sales expense column; honors the restricted-category exclusion.
    sumByDateForRange: async (storeId: string, from: Date, to: Date, excludeRestricted: boolean) => {
        return prisma.expense.groupBy({
            by: ['date'],
            where: {
                storeId,
                deletedAt: null,
                date: { gte: from, lte: to },
                ...(excludeRestricted ? { NOT: restrictedNot } : {}),
            },
            _sum: { amount: true },
        });
    },
    create: async (storeId: string, data: ExpenseCreateData) => {
        const { createdById, ...rest } = data;
        return prisma.expense.create({
            data: {
                ...rest,
                store: { connect: { id: storeId } },
                createdBy: { connect: { id: createdById } },
            },
            include: { createdBy: { select: { id: true, fullName: true, email: true } } },
        });
    },
    update: async (
        storeId: string,
        expenseId: string,
        data: Prisma.ExpenseUpdateManyMutationInput
    ) => {
        const updateResult = await prisma.expense.updateMany({
            where: { id: expenseId, storeId, deletedAt: null },
            data,
        });
        if (updateResult.count === 0) {
            return null;
        }
        return prisma.expense.findFirst({
            where: { id: expenseId, storeId, deletedAt: null },
            include: { createdBy: { select: { id: true, fullName: true, email: true } } },
        });
    },
    softDelete: async (storeId: string, expenseId: string) => {
        const updateResult = await prisma.expense.updateMany({
            where: { id: expenseId, storeId, deletedAt: null },
            data: { deletedAt: new Date() },
        });
        return updateResult.count > 0;
    },
};
