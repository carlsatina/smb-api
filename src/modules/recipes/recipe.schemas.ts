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

export const recipeLineSchema = z.object({
    ingredientId: z.string().min(1),
    qtyPerProductUnit: quantity,
});

export const recipeLinesUpdateSchema = z.object({
    lines: z.array(recipeLineSchema),
});
