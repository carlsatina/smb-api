import { z } from 'zod';

export const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    fullName: z.string().min(1).optional(),
    plan: z.enum(['STANDARD', 'GROWTH']).optional(),
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

export const updateProfileSchema = z.object({
    fullName: z.string().trim().min(1).max(120),
});

export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
});
