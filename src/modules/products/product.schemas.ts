import { ProductType } from '@prisma/client';
import { z } from 'zod';
import { recipeLineSchema } from '../recipes/recipe.schemas';

const optionalString = z.string().min(1).optional().nullable();
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

const recipeLinesSchema = z.array(recipeLineSchema);

// Explicit per-channel prices that don't follow the channel markup, keyed by channel: { GRAB: 115 }.
const channelPricesSchema = z.record(z.string().min(1).max(30), z.number().nonnegative()).optional();

export const productCreateSchema = z.object({
    name: z.string().min(1),
    type: z.nativeEnum(ProductType),
    sku: optionalString,
    barcode: optionalString,
    price: z.preprocess(
        (value) => (typeof value === 'string' ? Number(value) : value),
        z.number().nonnegative()
    ),
    cost: optionalNumber,
    unit: z.string().min(1),
    category: optionalString,
    subcategory: optionalString,
    channelPrices: channelPricesSchema,
    unavailableChannels: z.array(z.string().min(1).max(30)).max(10).optional(),
    active: z.boolean().optional(),
    lowStockThreshold: optionalNumber,
    recipeLines: recipeLinesSchema.optional(),
});

export const productUpdateSchema = z.object({
    name: z.string().min(1).optional(),
    type: z.nativeEnum(ProductType).optional(),
    sku: optionalString,
    barcode: optionalString,
    price: z
        .preprocess((value) => (typeof value === 'string' ? Number(value) : value), z.number().nonnegative())
        .optional(),
    cost: optionalNumber,
    unit: z.string().min(1).optional(),
    category: optionalString,
    subcategory: optionalString,
    channelPrices: channelPricesSchema,
    unavailableChannels: z.array(z.string().min(1).max(30)).max(10).optional(),
    active: z.boolean().optional(),
    lowStockThreshold: optionalNumber,
    recipeLines: recipeLinesSchema.optional(),
});
