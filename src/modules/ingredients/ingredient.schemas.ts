import { z } from 'zod';
import { IngredientCategory } from '@prisma/client';

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

const requiredNumber = z.preprocess(
    (value) => {
        if (typeof value === 'string') {
            return Number(value);
        }
        return value;
    },
    z.number().nonnegative()
);

export const ingredientCreateSchema = z.object({
    name: z.string().min(1),
    unit: z.string().min(1),
    category: z.nativeEnum(IngredientCategory).optional(),
    costPerUnit: requiredNumber,
    active: z.boolean().optional(),
    lowStockThreshold: optionalNumber,
    purchaseUnit: z.string().min(1).nullable().optional(),
    purchaseUnitSize: optionalNumber,
});

export const ingredientUpdateSchema = ingredientCreateSchema.partial();
