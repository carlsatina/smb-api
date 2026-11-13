import { ExpenseSource, Prisma, Role } from '@prisma/client';
import { AppError } from '../../shared/errors';
import prisma from '../../../lib/prisma';
import { expenseRepository, type ExpenseListFilters } from './expense.repository';
import type { PermissionKey } from '../../shared/permissions';
import { canViewRestrictedExpenses, isRestrictedCategory } from './expense.constants';
import { expenseDedupeKey, parseExpenseCsv } from './expense.csv';

export type ExpenseImportResult = {
    imported: number;
    skipped: number;
    failed: number;
    errors: Array<{ row: number; message: string }>;
};

type ExpenseInput = {
    date: string;
    amount: number;
    category: string;
    note?: string | null;
    source?: ExpenseSource;
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
    list: async (storeId: string, permissions: readonly PermissionKey[] | undefined, filters: ExpenseListFilters = {}) => {
        return expenseRepository.listByStore(storeId, {
            ...filters,
            excludeRestricted: !canViewRestrictedExpenses(permissions),
        });
    },
    get: async (storeId: string, permissions: readonly PermissionKey[] | undefined, expenseId: string) => {
        const expense = await expenseRepository.getById(storeId, expenseId);
        if (!expense) {
            throw new AppError('NOT_FOUND', 'Expense not found', 404);
        }
        // Don't leak restricted-category expenses to non-privileged roles.
        if (!canViewRestrictedExpenses(permissions) && isRestrictedCategory(expense.category)) {
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
            source: data.source,
            createdById: userId,
        });
    },
    /** `skipAudit` is for callers (the MCP server) that write their own audit entry. */
    update: async (
        storeId: string,
        expenseId: string,
        data: Partial<ExpenseInput>,
        userId?: string,
        options: { skipAudit?: boolean } = {}
    ) => {
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
            if (!options.skipAudit && Object.keys(changes).length > 0) {
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
    /**
     * Adds every valid row as a new MANUAL expense. Rows that exactly match an
     * expense already on file (date, amount, category, note) are skipped, so
     * re-importing an export doesn't double count; a file can still hold
     * several identical rows, only as many as already exist are skipped.
     */
    importCsv: async (storeId: string, userId: string, text: string): Promise<ExpenseImportResult> => {
        const store = await prisma.store.findFirst({
            where: { id: storeId, deletedAt: null },
            select: { expenseCategoryOptions: true },
        });
        if (!store) throw new AppError('NOT_FOUND', 'Store not found', 404);

        const { rows, errors } = parseExpenseCsv(text, store.expenseCategoryOptions);
        if (rows.length === 0) {
            if (errors.length === 1 && errors[0].row <= 1) {
                throw new AppError('INVALID_CSV', errors[0].message, 400);
            }
            return { imported: 0, skipped: 0, failed: errors.length, errors };
        }

        const dates = rows.map((r) => r.date).sort();
        const existing = await expenseRepository.listByStore(storeId, {
            from: dates[0],
            to: dates[dates.length - 1],
        });
        const onFile = new Map<string, number>();
        for (const e of existing) {
            const key = expenseDedupeKey({
                date: e.date.toISOString().slice(0, 10),
                amount: Number(e.amount),
                category: e.category,
                note: e.note,
            });
            onFile.set(key, (onFile.get(key) ?? 0) + 1);
        }

        const toCreate = rows.filter((row) => {
            const key = expenseDedupeKey(row);
            const remaining = onFile.get(key) ?? 0;
            if (remaining > 0) {
                onFile.set(key, remaining - 1);
                return false;
            }
            return true;
        });
        const skipped = rows.length - toCreate.length;

        if (toCreate.length > 0) {
            await prisma.$transaction([
                prisma.expense.createMany({
                    data: toCreate.map((row) => ({
                        storeId,
                        createdById: userId,
                        date: toDateOnly(row.date),
                        amount: new Prisma.Decimal(row.amount),
                        category: row.category,
                        note: row.note,
                        source: ExpenseSource.MANUAL,
                    })),
                }),
                prisma.auditLog.create({
                    data: {
                        store: { connect: { id: storeId } },
                        actor: { connect: { id: userId } },
                        action: 'EXPENSES_IMPORTED',
                        entityType: 'Expense',
                        entityId: storeId,
                        meta: {
                            imported: toCreate.length,
                            skipped,
                            failed: errors.length,
                            total: Number(toCreate.reduce((sum, r) => sum + r.amount, 0).toFixed(2)),
                            from: dates[0],
                            to: dates[dates.length - 1],
                        },
                    },
                }),
            ]);
        }

        return { imported: toCreate.length, skipped, failed: errors.length, errors };
    },
};
