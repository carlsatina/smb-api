import { z } from 'zod';
import { PlanTier } from '@prisma/client';

export const planOverrideSchema = z.object({
    planTier: z.nativeEnum(PlanTier),
    subscriptionActive: z.boolean(),
    emailVerified: z.boolean().optional(),
});

export const grantPlanSchema = z.object({
    grantedPlan: z.nativeEnum(PlanTier),
    grantedUntil: z.string().datetime({ offset: true }).nullable().optional(),
});

export const toggleSuperAdminSchema = z.object({
    isSuperAdmin: z.boolean(),
});

export const toggleBillingModeSchema = z.object({
    payPerReceipt: z.boolean(),
});

export const sendBillingSchema = z.object({
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(2020).max(2100),
    feeRate: z.number().min(0),
});
