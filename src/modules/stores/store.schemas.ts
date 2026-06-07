import { StoreType } from '@prisma/client';
import { z } from 'zod';

const optionalString = z.string().min(1).optional();
const optionalNumber = z.preprocess(
    (value) => {
        if (value === null || value === undefined || value === '') {
            return undefined;
        }
        if (typeof value === 'string') {
            return Number(value);
        }
        return value;
    },
    z.number().nonnegative()
).optional();
const optionalStringArray = z.array(z.string().min(1)).optional();

export const createStoreSchema = z.object({
    name: z.string().min(1),
    storeType: z.nativeEnum(StoreType).optional(),
    timezone: optionalString,
    currency: optionalString,
    allowNegativeStock: z.boolean().optional(),
    lowStockThreshold: optionalNumber,
    defaultTaxRate: optionalNumber,
    defaultDiscount: optionalNumber,
    unitOptions: optionalStringArray,
    categoryOptions: optionalStringArray,
});

export const updateStoreSchema = z
    .object({
        name: optionalString,
        storeType: z.nativeEnum(StoreType).optional(),
        timezone: optionalString,
        currency: optionalString,
        allowNegativeStock: z.boolean().optional(),
        lowStockThreshold: optionalNumber,
        defaultTaxRate: optionalNumber,
        defaultDiscount: optionalNumber,
        unitOptions: optionalStringArray,
        categoryOptions: optionalStringArray,
    })
    .refine(
        (data) =>
            data.name !== undefined ||
            data.storeType !== undefined ||
            data.timezone !== undefined ||
            data.currency !== undefined ||
            data.allowNegativeStock !== undefined ||
            data.lowStockThreshold !== undefined ||
            data.defaultTaxRate !== undefined ||
            data.defaultDiscount !== undefined ||
            data.unitOptions !== undefined ||
            data.categoryOptions !== undefined,
        {
            message: 'Provide at least one field to update.',
        }
    );
