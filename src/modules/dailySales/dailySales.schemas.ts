import { z } from 'zod';

export const listDailySalesQuerySchema = z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
});

export const createDailySalesEntrySchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    expense: z.number().min(0).default(0),
    actualCoh: z.number().min(0).nullable().optional(),
});

export const updateDailySalesEntrySchema = z.object({
    expense: z.number().min(0).optional(),
    actualCoh: z.number().min(0).nullable().optional(),
});

export const upsertCashierEntrySchema = z.object({
    gcashAmount: z.number().min(0).default(0),
    denom1000: z.number().int().min(0).default(0),
    denom500: z.number().int().min(0).default(0),
    denom200: z.number().int().min(0).default(0),
    denom100: z.number().int().min(0).default(0),
    denom50: z.number().int().min(0).default(0),
    denom20: z.number().int().min(0).default(0),
    coins: z.number().min(0).default(0),
});

export const posForDateSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

export const setGoalSchema = z.object({
    goal: z.number().min(0),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});
