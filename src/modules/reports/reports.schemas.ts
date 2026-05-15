import { z } from 'zod';

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

const dateValue = z.preprocess(
    (value) => {
        if (value === null || value === undefined || value === '') {
            return undefined;
        }
        if (value instanceof Date) {
            if (Number.isNaN(value.getTime())) {
                return value;
            }
            return value.toISOString().slice(0, 10);
        }
        if (typeof value === 'string') {
            if (datePattern.test(value)) {
                return value;
            }
            const parsed = new Date(value);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed.toISOString().slice(0, 10);
            }
        }
        return value;
    },
    z.string().regex(datePattern, { message: 'Invalid date format.' })
);

const limitValue = (defaultValue: number) =>
    z.preprocess(
        (value) => (value === undefined ? defaultValue : Number(value)),
        z.number().int().min(1).max(50)
    ).default(defaultValue);

export const reportRangeSchema = z
    .object({
        from: dateValue.optional(),
        to: dateValue.optional(),
    })
    .refine((data) => !data.from || !data.to || data.from <= data.to, {
        message: 'From must be before to.',
        path: ['from'],
    });

export const reportSalesSummaryQuerySchema = reportRangeSchema;

export const reportSalesByHourQuerySchema = reportRangeSchema;

export const reportTopProductsQuerySchema = reportRangeSchema.safeExtend({
    limit: limitValue(8),
});

export const reportIngredientUsageQuerySchema = reportRangeSchema.safeExtend({
    limit: limitValue(8),
});

export const reportPurchaseSpendQuerySchema = reportRangeSchema.safeExtend({
    limit: limitValue(8),
});

export const reportMarginQuerySchema = reportRangeSchema.safeExtend({
    limit: limitValue(8),
});

export const reportLowStockQuerySchema = z.object({
    limit: limitValue(8),
});
