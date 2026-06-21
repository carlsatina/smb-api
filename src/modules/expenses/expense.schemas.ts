import { z } from 'zod';
import { ExpenseSource } from '@prisma/client';

const optionalNote = z.preprocess(
    (value) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        return value;
    },
    z.string().max(500).nullable()
);

export const expenseCreateSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    amount: z.number().positive('Amount must be greater than 0'),
    category: z.string().min(1, 'Category is required').max(100),
    note: optionalNote.optional(),
    source: z.nativeEnum(ExpenseSource).optional(),
});

// `source` is set at creation time only — it must not be changed on update.
export const expenseUpdateSchema = expenseCreateSchema.omit({ source: true }).partial();

export const listExpensesQuerySchema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    category: z.string().min(1).optional(),
    source: z.nativeEnum(ExpenseSource).optional(),
});
