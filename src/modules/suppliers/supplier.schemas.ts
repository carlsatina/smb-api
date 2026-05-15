import { z } from 'zod';

const optionalString = z.preprocess(
    (value) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        return value;
    },
    z.string().min(1).nullable()
);

const optionalEmail = z.preprocess(
    (value) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        return value;
    },
    z.string().email().nullable()
);

export const supplierCreateSchema = z.object({
    name: z.string().min(1),
    email: optionalEmail.optional(),
    phone: optionalString.optional(),
});

export const supplierUpdateSchema = supplierCreateSchema.partial();
