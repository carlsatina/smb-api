import { z } from 'zod';
import { BillingDiscountType } from '@prisma/client';

export const toggleSuperAdminSchema = z.object({
    isSuperAdmin: z.boolean(),
});

const billingPeriod = {
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(2020).max(2100),
};

export const sendBillingSchema = z.object(billingPeriod);

export const billingPaymentSchema = z.object({
    ...billingPeriod,
    paid: z.boolean(),
    note: z.string().trim().max(500).nullable().optional(),
});

// Optional "through" month: the setting stops after that billing month.
const throughMonth = {
    throughYear: z.number().int().min(2020).max(2100).nullable().optional(),
    throughMonth: z.number().int().min(1).max(12).nullable().optional(),
};

const note = z.string().trim().max(200).nullable().optional();

export const ownerDiscountSchema = z.object({
    discount: z
        .object({
            type: z.nativeEnum(BillingDiscountType),
            value: z.number().positive(),
            note,
            ...throughMonth,
        })
        .refine((d) => d.type !== 'PERCENT' || d.value <= 100, {
            message: 'A percentage discount cannot exceed 100.',
            path: ['value'],
        })
        .refine((d) => Boolean(d.throughYear) === Boolean(d.throughMonth), {
            message: 'Give both the year and month the discount runs through, or neither.',
            path: ['throughMonth'],
        })
        .nullable(),
});

export const storeExemptionSchema = z
    .object({
        exempt: z.boolean(),
        note,
        ...throughMonth,
    })
    .refine((d) => Boolean(d.throughYear) === Boolean(d.throughMonth), {
        message: 'Give both the year and month the store is free through, or neither.',
        path: ['throughMonth'],
    });
