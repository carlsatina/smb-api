import { Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors';
import prisma from '../../../lib/prisma';
import { expenseRepository, type ExpenseListFilters } from './expense.repository';

type ExpenseInput = {
    date: string;
    amount: number;
    category: string;
    note?: string | null;
};

const toDateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);

const buildExpenseChanges = (
    before: { date: Date; amount: Prisma.Decimal; category: string; note: string | null },
    after: { date: Date; amount: Prisma.Decimal; category: string; note: string | null }
) => {
    const changes: Record<string, { from: string | null; to: string | null }> = {};
    if (before.date.toISOString() !== after.date.toISOString()) {
        changes.date = { from: before.date.toISOString().slice(0, 10), to: after.date.toISOString().slice(0, 10) };
    }
    if (!before.amount.equals(after.amount)) {
        changes.amount = { from: before.amount.toString(), to: after.amount.toString() };
    }
    if (before.category !== after.category) {
        changes.category = { from: before.category, to: after.category };
    }
    if ((before.note ?? null) !== (after.note ?? null)) {
        changes.note = { from: before.note ?? null, to: after.note ?? null };
    }
    return changes;
};

export const expenseService = {
    list: async (storeId: string, filters: ExpenseListFilters = {}) => {
        return expenseRepository.listByStore(storeId, filters);
    },
    get: async (storeId: string, expenseId: string) => {
        const expense = await expenseRepository.getById(storeId, expenseId);
        if (!expense) {
            throw new AppError('NOT_FOUND', 'Expense not found', 404);
        }
        return expense;
    },
    create: async (storeId: string, userId: string, data: ExpenseInput) => {
        return expenseRepository.create(storeId, {
            date: toDateOnly(data.date),
            amount: new Prisma.Decimal(data.amount),
            category: data.category,
            note: data.note ?? null,
            createdById: userId,
        });
    },
    update: async (storeId: string, expenseId: string, data: Partial<ExpenseInput>, userId?: string) => {
        const existing = await expenseRepository.getById(storeId, expenseId);
        if (!existing) {
            throw new AppError('NOT_FOUND', 'Expense not found', 404);
        }

        const updateData: Prisma.ExpenseUpdateManyMutationInput = {};
        if (data.date !== undefined) updateData.date = toDateOnly(data.date);
        if (data.amount !== undefined) updateData.amount = new Prisma.Decimal(data.amount);
        if (data.category !== undefined) updateData.category = data.category;
        if (data.note !== undefined) updateData.note = data.note ?? null;

        return prisma.$transaction(async (tx) => {
            const updateResult = await tx.expense.updateMany({
                where: { id: expenseId, storeId, deletedAt: null },
                data: updateData,
            });
            if (updateResult.count === 0) {
                throw new AppError('NOT_FOUND', 'Expense not found', 404);
            }

            const result = await tx.expense.findFirst({
                where: { id: expenseId, storeId },
                include: { createdBy: { select: { id: true, fullName: true, email: true } } },
            });
            if (!result) {
                throw new AppError('NOT_FOUND', 'Expense not found', 404);
            }

            const changes = buildExpenseChanges(
                { date: existing.date, amount: existing.amount, category: existing.category, note: existing.note },
                { date: result.date, amount: result.amount, category: result.category, note: result.note }
            );
            if (Object.keys(changes).length > 0) {
                const auditData: Prisma.AuditLogCreateInput = {
                    store: { connect: { id: storeId } },
                    action: 'EXPENSE_UPDATED',
                    entityType: 'Expense',
                    entityId: expenseId,
                    meta: { changes },
                };
                if (userId) {
                    auditData.actor = { connect: { id: userId } };
                }
                await tx.auditLog.create({ data: auditData });
            }

            return result;
        });
    },
    remove: async (storeId: string, expenseId: string, userId?: string) => {
        const deleted = await expenseRepository.softDelete(storeId, expenseId);
        if (!deleted) {
            throw new AppError('NOT_FOUND', 'Expense not found', 404);
        }
        const auditData: Prisma.AuditLogCreateInput = {
            store: { connect: { id: storeId } },
            action: 'EXPENSE_DELETED',
            entityType: 'Expense',
            entityId: expenseId,
            meta: {},
        };
        if (userId) {
            auditData.actor = { connect: { id: userId } };
        }
        await prisma.auditLog.create({ data: auditData });
    },
};
