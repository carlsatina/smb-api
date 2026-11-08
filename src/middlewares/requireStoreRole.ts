import { NextFunction, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../shared/errors';
import { BILLING_SUSPENDED_MESSAGE, READ_ONLY_METHODS } from '../shared/billingStatus';
import {
    effectivePermissions,
    parseMemberPermissionOverrides,
    parseRolePermissionOverrides,
} from '../shared/permissions';
import { AuthRequest } from './auth';

// Shared by loadStoreMembership and the MCP server (which checks several
// stores in one query), so both apply exactly the same rules.
export const membershipSelect = {
    storeId: true,
    role: true,
    suspendedAt: true,
    permissionOverrides: true,
    store: {
        select: {
            rolePermissions: true,
            // The billed owner (earliest active owner) decides whether
            // the store is locked for non-payment.
            members: {
                where: { role: Role.OWNER, deletedAt: null },
                orderBy: { createdAt: 'asc' },
                take: 1,
                select: { user: { select: { billingSuspendedAt: true } } },
            },
        },
    },
} satisfies Prisma.StoreMemberSelect;

export type MembershipRow = Prisma.StoreMemberGetPayload<{ select: typeof membershipSelect }>;

export const evaluateMembership = (membership: MembershipRow) => ({
    role: membership.role,
    memberSuspended: Boolean(membership.suspendedAt),
    // Non-payment makes the whole store read-only for every member: reads and
    // exports still work so nobody loses access to their records.
    billingSuspended: Boolean(membership.store?.members?.[0]?.user?.billingSuspendedAt),
    permissions: effectivePermissions(
        membership.role,
        parseRolePermissionOverrides(membership.store?.rolePermissions),
        parseMemberPermissionOverrides(membership.permissionOverrides)
    ),
});

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
        select: membershipSelect,
    });

    if (!membership) {
        throw new AppError('FORBIDDEN', 'Not a member of this store', 403);
    }

    const access = evaluateMembership(membership);

    // Suspension is enforced here rather than in each module. Given its own code
    // so the client can say why access stopped instead of a blank "forbidden".
    if (access.memberSuspended) {
        throw new AppError('MEMBER_SUSPENDED', 'Your access to this store has been suspended.', 403);
    }

    if (access.billingSuspended && !READ_ONLY_METHODS.has(req.method)) {
        throw new AppError('BILLING_SUSPENDED', BILLING_SUSPENDED_MESSAGE, 402);
    }

    req.storeRole = access.role;
    req.permissions = access.permissions;
    return access.role;
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
