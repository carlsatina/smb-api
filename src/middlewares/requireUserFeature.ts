import { NextFunction, Response } from 'express';
import prisma from '../../lib/prisma';
import { AppError } from '../shared/errors';
import { AuthRequest } from './auth';

export const requireUserFeature = (feature: string) => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        const userId = req.user?.sub;
        if (!userId) {
            return next(new AppError('UNAUTHORIZED', 'Missing user context', 401));
        }

        const grant = await prisma.userFeature.findUnique({
            where: { userId_feature: { userId, feature } },
            select: { expiresAt: true },
        });

        if (!grant || (grant.expiresAt && grant.expiresAt < new Date())) {
            return next(new AppError('FEATURE_NOT_GRANTED', 'You do not have access to this feature', 403));
        }

        return next();
    };
};
