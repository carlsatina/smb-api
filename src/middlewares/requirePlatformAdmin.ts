import { NextFunction, Response } from 'express';
import { AppError } from '../shared/errors';
import { AuthRequest } from './auth';

export const requirePlatformAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user?.isSuperAdmin) {
        return next(new AppError('FORBIDDEN', 'Platform admin access required.', 403));
    }
    return next();
};
