import { Request, Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { adminCsrfMiddleware, csrfMiddleware } from '../../middlewares/csrf';
import { requirePlatformAdmin } from '../../middlewares/requirePlatformAdmin';
import { createRateLimiter } from '../../middlewares/rateLimit';
import {
    adminLogin,
    adminLogout,
    adminRefresh,
    changePassword,
    forgotPassword,
    login,
    logout,
    me,
    refresh,
    register,
    resendVerification,
    resetPassword,
    updateProfile,
    verifyEmail,
} from './auth.controller';

export const authRouter = Router();

const authKey = (req: Request) => `${req.ip || 'unknown'}:${req.path || ''}`;

const registerLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: 'Too many registration attempts. Please try again later.',
    keyGenerator: authKey,
});

const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many failed login attempts. Please try again later.',
    keyGenerator: authKey,
    countOnlyOnFailure: true,
});

const refreshLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: 'Too many refresh attempts. Please try again later.',
    keyGenerator: authKey,
});

const forgotLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: 'Too many reset requests. Please try again later.',
    keyGenerator: authKey,
});

const resetLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Too many password reset attempts. Please try again later.',
    keyGenerator: authKey,
});

const verifyLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'Too many verification attempts. Please try again later.',
    keyGenerator: authKey,
});

const verifyRequestLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: 'Too many verification requests. Please try again later.',
    keyGenerator: authKey,
});

authRouter.post('/register', registerLimiter, register);
authRouter.post('/login', loginLimiter, login);
authRouter.post('/refresh', refreshLimiter, csrfMiddleware, refresh);
authRouter.post('/logout', csrfMiddleware, logout);
authRouter.post('/password/forgot', forgotLimiter, forgotPassword);
authRouter.post('/password/reset', resetLimiter, resetPassword);
authRouter.post('/verify', verifyLimiter, verifyEmail);
authRouter.post('/verify/resend', verifyRequestLimiter, resendVerification);
authRouter.get('/me', authMiddleware, me);
authRouter.patch('/me', authMiddleware, updateProfile);
authRouter.post('/password/change', authMiddleware, changePassword);

// Platform admin portal — separate, audience-scoped session.
authRouter.post('/admin/login', loginLimiter, adminLogin);
authRouter.post('/admin/refresh', refreshLimiter, adminCsrfMiddleware, adminRefresh);
authRouter.post('/admin/logout', adminCsrfMiddleware, adminLogout);
authRouter.get('/admin/me', authMiddleware, requirePlatformAdmin, me);
