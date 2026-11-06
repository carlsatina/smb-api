import { NextFunction, Response } from 'express';
import { AppError } from '../shared/errors';
import type { PermissionKey } from '../shared/permissions';
import { AuthRequest } from './auth';
import { loadStoreMembership } from './requireStoreRole';

/** Passes when the member has at least one of the given permissions. */
export const requirePermission = (...anyOf: PermissionKey[]) => {
    return async (req: AuthRequest, _res: Response, next: NextFunction) => {
        try {
            await loadStoreMembership(req);
            if (!anyOf.some((permission) => req.permissions?.includes(permission))) {
                return next(new AppError('FORBIDDEN', "Your role doesn't have permission to do this.", 403));
            }
            return next();
        } catch (error) {
            return next(error);
        }
    };
};

/** Any active member of the store (reads that every role can see). */
export const requireStoreMember = () => {
    return async (req: AuthRequest, _res: Response, next: NextFunction) => {
        try {
            await loadStoreMembership(req);
            return next();
        } catch (error) {
            return next(error);
        }
    };
};

export const hasPermission = (req: AuthRequest, permission: PermissionKey) =>
    Boolean(req.permissions?.includes(permission));
