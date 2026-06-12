import { NextFunction, Response } from 'express';
import prisma from '../../lib/prisma';
import { AppError } from '../shared/errors';
import { AuthRequest } from './auth';

export const requirePlatformAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.sub;
    if (!userId) {
        return next(new AppError('UNAUTHORIZED', 'Missing user context', 401));
    }

    // Only admin-audience tokens (issued via the admin portal login) may reach admin routes.
    if (req.user?.aud !== 'admin') {
        return next(new AppError('FORBIDDEN', 'Platform admin access required.', 403));
    }

    // Re-check against the database so revoking super-admin takes effect immediately,
    // not only once the access token expires or is refreshed.
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isSuperAdmin: true },
    });

    if (!user?.isSuperAdmin) {
        return next(new AppError('FORBIDDEN', 'Platform admin access required.', 403));
    }

    return next();
};
