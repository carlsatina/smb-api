import { z } from 'zod';

export const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    fullName: z.string().min(1).optional(),
});

export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

export const refreshSchema = z.object({
    refreshToken: z.string().min(1).optional(),
});

export const forgotPasswordSchema = z.object({
    email: z.string().email(),
});

// TODO(production): remove this schema and endpoint before going live.
// Plan changes must go through a payment provider (e.g. Stripe) and be
// confirmed via webhook — never trusted from the client directly.
export const devUpgradePlanSchema = z.object({
    planTier: z.enum(['STARTER', 'STANDARD', 'GROWTH']),
});

export const resetPasswordSchema = z.object({
    token: z.string().min(1),
    password: z.string().min(8),
});

export const verifyEmailSchema = z.object({
    token: z.string().min(1),
});

export const resendVerificationSchema = z.object({
    email: z.string().email(),
});
