import { NextFunction, Response } from 'express';
import { getCsrfTokenFromRequest } from '../modules/auth/auth.cookies';
import { AppError } from '../shared/errors';
import { AuthRequest } from './auth';

export const csrfMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    const cookieToken = getCsrfTokenFromRequest(req);
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
