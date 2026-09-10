import { z } from 'zod';

export const getDailyReportQuerySchema = z.object({
    reportType: z.enum(['TAKOYAKI', 'BUKO', 'CUSTOM']).default('TAKOYAKI'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

export const saveDailyReportItemSchema = z.object({
    id: z.string().optional(),
    section: z.string().nullable().optional(),
    particulars: z.string().min(1, 'Particulars is required'),
    unit: z.string().min(1, 'Unit is required'),
    openingInventory: z.number().min(0).default(0),
    delivery: z.number().min(0).default(0),
    endingInventory: z.number().min(0).nullable().optional(),
    reminders: z.string().nullable().optional(),
    sortOrder: z.number().int().optional(),
    itemType: z.enum(['PRODUCT', 'INGREDIENT']).nullable().optional(),
    itemId: z.string().nullable().optional(),
});

export const saveDailyReportSchema = z.object({
    reportType: z.enum(['TAKOYAKI', 'BUKO', 'CUSTOM']).default('TAKOYAKI'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    items: z.array(saveDailyReportItemSchema).min(1, 'At least one item is required'),
});
