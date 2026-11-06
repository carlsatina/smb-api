import { NextFunction, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../shared/errors';
import {
    effectivePermissions,
    parseMemberPermissionOverrides,
    parseRolePermissionOverrides,
} from '../shared/permissions';
import { AuthRequest } from './auth';

/**
 * Verifies the user is an active member of the route's :storeId and attaches
 * their role and effective permissions to the request. Every store route passes
 * through here (directly or via requirePermission / requireStoreMember).
 */
export const loadStoreMembership = async (req: AuthRequest) => {
    const storeId = req.params.storeId;
    const userId = req.user?.sub;

    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }
    if (!userId) {
        throw new AppError('UNAUTHORIZED', 'Missing user context', 401);
    }

    const membership = await prisma.storeMember.findFirst({
        where: {
            storeId,
            userId,
            deletedAt: null,
        },
        select: {
            role: true,
            suspendedAt: true,
            permissionOverrides: true,
            store: { select: { rolePermissions: true } },
        },
    });

    if (!membership) {
        throw new AppError('FORBIDDEN', 'Not a member of this store', 403);
    }

    // Suspension is enforced here rather than in each module. Given its own code
    // so the client can say why access stopped instead of a blank "forbidden".
    if (membership.suspendedAt) {
        throw new AppError('MEMBER_SUSPENDED', 'Your access to this store has been suspended.', 403);
    }

    req.storeRole = membership.role;
    req.permissions = effectivePermissions(
        membership.role,
        parseRolePermissionOverrides(membership.store?.rolePermissions),
        parseMemberPermissionOverrides(membership.permissionOverrides)
    );
    return membership.role;
};

/** Role gate, kept for the few owner-only actions that are never delegable. */
export const requireStoreRole = (roles: Role[]) => {
    return async (req: AuthRequest, _res: Response, next: NextFunction) => {
        try {
            const role = await loadStoreMembership(req);
            if (!roles.includes(role)) {
                return next(new AppError('FORBIDDEN', 'Insufficient role', 403));
            }
            return next();
        } catch (error) {
            return next(error);
        }
    };
};
