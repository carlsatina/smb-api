import { z } from 'zod';

const optionalString = z.string().min(1).optional();

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

export const auditLogQuerySchema = z.object({
    action: optionalString,
    actorId: optionalString,
    entityType: optionalString,
    q: optionalString,
    from: dateValue.optional(),
    to: dateValue.optional(),
    page: z
        .preprocess((value) => (value === undefined ? 1 : Number(value)), z.number().int().min(1))
        .default(1),
    pageSize: z
        .preprocess((value) => (value === undefined ? 25 : Number(value)), z.number().int().min(1).max(100))
        .default(25),
});

export const auditLogExportQuerySchema = z.object({
    action: optionalString,
    actorId: optionalString,
    entityType: optionalString,
    from: dateValue.optional(),
    to: dateValue.optional(),
});
