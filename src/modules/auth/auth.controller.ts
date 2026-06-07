import { Request, Response } from 'express';
import prisma from '../../../lib/prisma';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { authService } from './auth.service';
import {
    clearCsrfTokenCookie,
    clearRefreshTokenCookie,
    generateCsrfToken,
    getRefreshTokenFromRequest,
    setCsrfTokenCookie,
    setRefreshTokenCookie,
} from './auth.cookies';
import {
    forgotPasswordSchema,
    loginSchema,
    refreshSchema,
    registerSchema,
    resendVerificationSchema,
    resetPasswordSchema,
    verifyEmailSchema,
} from './auth.schemas';

export const register = asyncHandler(async (req: Request, res: Response) => {
    const payload = registerSchema.parse(req.body);
    const result = await authService.register(payload.email, payload.password, payload.fullName, payload.plan);
    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = generateCsrfToken();
    setCsrfTokenCookie(res, csrfToken);
    res.status(201).json({
        user: result.user,
        accessToken: result.accessToken,
        csrfToken,
    });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
    const payload = loginSchema.parse(req.body);
    const result = await authService.login(payload.email, payload.password);
    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = generateCsrfToken();
    setCsrfTokenCookie(res, csrfToken);
    res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
        csrfToken,
    });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
    const payload = refreshSchema.parse(req.body);
    const refreshToken = payload.refreshToken ?? getRefreshTokenFromRequest(req);
    if (!refreshToken) {
        res.status(400).json({ error: { code: 'REFRESH_REQUIRED', message: 'Refresh token is required.' } });
        return;
    }
    const result = await authService.refresh(refreshToken);
    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = generateCsrfToken();
    setCsrfTokenCookie(res, csrfToken);
    res.status(200).json({
        accessToken: result.accessToken,
        csrfToken,
    });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
    const payload = refreshSchema.parse(req.body);
    const refreshToken = payload.refreshToken ?? getRefreshTokenFromRequest(req);
    if (refreshToken) {
        await authService.logout(refreshToken);
    }
    clearRefreshTokenCookie(res);
    clearCsrfTokenCookie(res);
    res.status(204).send();
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
    const payload = forgotPasswordSchema.parse(req.body);
    const result = await authService.requestPasswordReset(payload.email);
    res.status(200).json(result);
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
    const payload = resetPasswordSchema.parse(req.body);
    const result = await authService.resetPassword(payload.token, payload.password);
    res.status(200).json(result);
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
    const payload = verifyEmailSchema.parse(req.body);
    const result = await authService.verifyEmail(payload.token);
    res.status(200).json(result);
});

export const resendVerification = asyncHandler(async (req: Request, res: Response) => {
    const payload = resendVerificationSchema.parse(req.body);
    const result = await authService.requestEmailVerification(payload.email);
    res.status(200).json(result);
});

export const me = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.sub;
    if (!userId) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
        return;
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            fullName: true,
            subscriptionActive: true,
            planTier: true,
            grantedPlan: true,
            grantedUntil: true,
            isSuperAdmin: true,
            emailVerifiedAt: true,
        },
    });

    if (!user) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
        return;
    }

    res.status(200).json({
        user: {
            ...user,
            emailVerified: Boolean(user.emailVerifiedAt),
        },
    });
});

