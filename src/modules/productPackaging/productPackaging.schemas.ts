import { z } from 'zod';

const quantity = z.preprocess(
    (value) => {
        if (typeof value === 'string') {
            return Number(value);
        }
        return value;
    },
    z.number().positive()
);

export const packagingLineSchema = z.object({
    ingredientId: z.string().min(1),
    qtyPerUnit: quantity,
});

export const packagingLinesUpdateSchema = z.object({
    lines: z.array(packagingLineSchema),
});
