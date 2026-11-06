import { AiProvider, StoreType } from '@prisma/client';
import { z } from 'zod';
import { EDITABLE_ROLES, PERMISSION_KEYS } from '../../shared/permissions';
import { CHANNEL_ROUNDING } from '../../shared/salesChannels';

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
const optionalSubcategoryOptions = z.record(z.string().min(1), z.array(z.string().min(1).max(60))).optional();

const VALID_PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'GCASH', 'MAYA', 'OTHER'] as const;
const optionalPaymentMethods = z.preprocess(
    (value) => {
        if (!Array.isArray(value)) return value;
        const validSet = new Set<string>(VALID_PAYMENT_METHODS);
        const filtered = value.filter((x): x is typeof VALID_PAYMENT_METHODS[number] => typeof x === 'string' && validSet.has(x));
        return filtered.length > 0 ? filtered : undefined;
    },
    z.array(z.enum(VALID_PAYMENT_METHODS)).min(1, 'At least one payment method required')
).optional();

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
    subcategoryOptions: optionalSubcategoryOptions,
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
        subcategoryOptions: optionalSubcategoryOptions,
        expenseCategoryOptions: optionalStringArray,
        cashierSalesHistoryLimit: optionalPositiveInt,
        paymentMethods: optionalPaymentMethods,
        salesChannels: z
            .array(
                z.object({
                    key: z.string().min(1).max(30).nullable().optional(),
                    name: z.string().trim().min(1).max(40),
                    markupPercent: z.number().min(0).max(500),
                    rounding: z.enum(CHANNEL_ROUNDING),
                    alwaysTakeout: z.boolean(),
                    active: z.boolean(),
                })
            )
            .max(10)
            .optional(),
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
            data.subcategoryOptions !== undefined ||
            data.expenseCategoryOptions !== undefined ||
            data.cashierSalesHistoryLimit !== undefined ||
            data.paymentMethods !== undefined ||
            data.salesChannels !== undefined,
        {
            message: 'Provide at least one field to update.',
        }
    );

// AI integration settings. The API key is write-only: an empty string or null
// clears the stored key; omitting it leaves the existing key untouched.
export const updateAiSettingsSchema = z.object({
    aiProvider: z.nativeEnum(AiProvider).nullable().optional(),
    aiModel: z.string().trim().max(120).nullable().optional(),
    aiApiKey: z.string().max(500).nullable().optional(),
});

// Full grid for the editable roles: role -> granted permission keys. Owner is
// implicit (always everything) and can't be sent.
const permissionKey = z.string().refine((value) => (PERMISSION_KEYS as string[]).includes(value), {
    message: 'Unknown permission.',
});
export const updateRolePermissionsSchema = z.object({
    matrix: z
        .object(
            Object.fromEntries(EDITABLE_ROLES.map((role) => [role, z.array(permissionKey).optional()])) as Record<
                (typeof EDITABLE_ROLES)[number],
                z.ZodOptional<z.ZodArray<typeof permissionKey>>
            >
        )
        .strict(),
});
