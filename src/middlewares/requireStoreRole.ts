import { NextFunction, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../shared/errors';
import { AuthRequest } from './auth';

export const requireStoreRole = (roles: Role[]) => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        const storeId = req.params.storeId;
        const userId = req.user?.sub;

        if (!storeId) {
            return next(new AppError('STORE_REQUIRED', 'Store is required', 400));
        }

        if (!userId) {
            return next(new AppError('UNAUTHORIZED', 'Missing user context', 401));
        }

        const membership = await prisma.storeMember.findFirst({
            where: {
                storeId,
                userId,
                deletedAt: null,
            },
            select: {
                role: true,
            },
        });

        if (!membership) {
            return next(new AppError('FORBIDDEN', 'Not a member of this store', 403));
        }

        if (!roles.includes(membership.role)) {
            return next(new AppError('FORBIDDEN', 'Insufficient role', 403));
        }

        req.storeRole = membership.role;
        return next();
    };
};
