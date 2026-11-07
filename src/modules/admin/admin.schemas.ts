import { z } from 'zod';

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
