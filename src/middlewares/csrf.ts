import { NextFunction, Request, Response } from 'express';
import { getAdminCsrfTokenFromRequest, getCsrfTokenFromRequest } from '../modules/auth/auth.cookies';
import { AppError } from '../shared/errors';
import { AuthRequest } from './auth';

const verifyCsrf = (req: Request, cookieToken: string | null, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    const headerToken =
        (req.headers['x-csrf-token'] as string | undefined) ||
        (req.headers['x-xsrf-token'] as string | undefined);

    if (!cookieToken) {
        return next(new AppError('CSRF_REQUIRED', 'Missing CSRF cookie', 403));
    }

    if (!headerToken || headerToken !== cookieToken) {
        return next(new AppError('CSRF_INVALID', 'Invalid CSRF token', 403));
    }

    return next();
};

export const csrfMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
    return verifyCsrf(req, getCsrfTokenFromRequest(req), next);
};

export const adminCsrfMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
    return verifyCsrf(req, getAdminCsrfTokenFromRequest(req), next);
};
