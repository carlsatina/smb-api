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

const optionalPositiveInt = z.preprocess(
    (value) => {
        if (value === null || value === undefined || value === '') return null;
        if (typeof value === 'string') return Number(value);
        return value;
    },
    z.number().int().positive().nullable()
).optional();
const optionalStringArray = z.array(z.string().min(1)).optional();

const VALID_PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'GCASH', 'MAYA', 'OTHER'] as const;
const optionalPaymentMethods = z.array(z.enum(VALID_PAYMENT_METHODS)).min(1, 'At least one payment method required').optional();

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
    expenseCategoryOptions: optionalStringArray,
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
        expenseCategoryOptions: optionalStringArray,
        cashierSalesHistoryLimit: optionalPositiveInt,
        paymentMethods: optionalPaymentMethods,
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
            data.categoryOptions !== undefined ||
            data.expenseCategoryOptions !== undefined ||
            data.cashierSalesHistoryLimit !== undefined ||
            data.paymentMethods !== undefined,
        {
            message: 'Provide at least one field to update.',
        }
    );
