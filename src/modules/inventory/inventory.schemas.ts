import { ItemType, MovementType } from '@prisma/client';
import { z } from 'zod';

const optionalString = z.string().min(1).optional();

const optionalNumber = z.preprocess(
    (value) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        if (typeof value === 'string') {
            return Number(value);
        }
        return value;
    },
    z.number().nonnegative().nullable()
).optional();

const optionalNumberValue = z.preprocess(
    (value) => {
        if (value === null || value === undefined || value === '') {
            return undefined;
        }
        if (typeof value === 'string') {
            return Number(value);
        }
        return value;
    },
    z.number().optional()
);

const optionalNonNegativeNumber = z.preprocess(
    (value) => {
        if (value === null || value === undefined || value === '') {
            return undefined;
        }
        if (typeof value === 'string') {
            return Number(value);
        }
        return value;
    },
    z.number().nonnegative().optional()
);

const dateValue = z.preprocess(
    (value) => {
        if (value === null || value === undefined || value === '') {
            return undefined;
        }
        if (value instanceof Date) {
            return value;
        }
        return new Date(String(value));
    },
    z.date()
);

export const inventoryStockQuerySchema = z.object({
    itemType: z.nativeEnum(ItemType).optional(),
    itemId: optionalString,
});

export const inventoryMovementQuerySchema = z.object({
    itemType: z.nativeEnum(ItemType).optional(),
    itemId: optionalString,
    type: z.nativeEnum(MovementType).optional(),
    createdById: optionalString,
    from: dateValue.optional(),
    to: dateValue.optional(),
    page: z
        .preprocess((value) => (value === undefined ? 1 : Number(value)), z.number().int().min(1))
        .default(1),
    pageSize: z
        .preprocess((value) => (value === undefined ? 25 : Number(value)), z.number().int().min(1).max(100))
        .default(25),
});

export const stockAdjustmentSchema = z
    .object({
        itemType: z.nativeEnum(ItemType),
        itemId: z.string().min(1),
        adjustmentMode: z.enum(['DELTA', 'SET']).optional(),
        qtyDelta: optionalNumberValue,
        targetQty: optionalNonNegativeNumber,
        unitCost: optionalNumber,
        note: z.string().max(500).optional().nullable(),
    })
    .superRefine((value, ctx) => {
        const hasDelta = typeof value.qtyDelta === 'number';
        const hasTarget = typeof value.targetQty === 'number';

        if (hasDelta && value.qtyDelta === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['qtyDelta'],
                message: 'Quantity delta must be non-zero.',
            });
        }

        if (value.adjustmentMode === 'DELTA') {
            if (!hasDelta) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['qtyDelta'],
                    message: 'Quantity delta is required for delta adjustments.',
                });
            }
            if (hasTarget) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['targetQty'],
                    message: 'Target stock is not allowed for delta adjustments.',
                });
            }
            return;
        }

        if (value.adjustmentMode === 'SET') {
            if (!hasTarget) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['targetQty'],
                    message: 'Target stock is required for set adjustments.',
                });
            }
            if (hasDelta) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['qtyDelta'],
                    message: 'Quantity delta is not allowed for set adjustments.',
                });
            }
            return;
        }

        if (!hasDelta && !hasTarget) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Provide either a quantity delta or a target stock.',
            });
        }

        if (hasDelta && hasTarget) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Provide only one of quantity delta or target stock.',
            });
        }
    });

const transferDateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Transfer date must be in YYYY-MM-DD format.')
    .optional()
    .nullable();

export const transferStockSchema = z.object({
    destinationStoreId: z.string().min(1),
    itemType: z.nativeEnum(ItemType),
    itemId: z.string().min(1),
    qty: z.number().positive(),
    note: z.string().max(500).optional().nullable(),
    transferDate: transferDateSchema,
});

export const batchTransferStockSchema = z.object({
    destinationStoreId: z.string().min(1),
    items: z
        .array(
            z.object({
                itemType: z.nativeEnum(ItemType),
                itemId: z.string().min(1),
                qty: z.number().positive(),
            })
        )
        .min(1, 'At least one item is required.'),
    note: z.string().max(500).optional().nullable(),
    transferDate: transferDateSchema,
});
