import { z } from 'zod';
import { PlanTier } from '@prisma/client';

export const planOverrideSchema = z.object({
    planTier: z.nativeEnum(PlanTier),
    subscriptionActive: z.boolean(),
    emailVerified: z.boolean().optional(),
});
