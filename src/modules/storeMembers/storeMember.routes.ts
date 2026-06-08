import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { createRateLimiter } from '../../middlewares/rateLimit';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import {
    acceptInvite,
    createInvite,
    listInvites,
    listMembers,
    previewInvite,
    removeMember,
    revokeInvite,
    updateMemberRole,
} from './storeMember.controller';

export const storeMemberRouter = Router({ mergeParams: true });
export const storeInviteRouter = Router({ mergeParams: true });

const readRoles = [Role.OWNER, Role.ADMIN, Role.CASHIER, Role.INVENTORY_MANAGER, Role.VIEWER];
const manageRoles = [Role.OWNER, Role.ADMIN];

const inviteLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 20,
    message: 'Too many invite requests. Please try again later.',
});

const acceptLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 20,
    message: 'Too many invite accepts. Please try again later.',
});

// Public — no auth required
storeInviteRouter.get('/preview', acceptLimiter, previewInvite);

storeMemberRouter.use(authMiddleware);
storeInviteRouter.use(authMiddleware);

storeMemberRouter.get('/', requireStoreRole(readRoles), listMembers);
storeMemberRouter.patch('/:memberId', requireStoreRole(manageRoles), updateMemberRole);
storeMemberRouter.delete('/:memberId', requireStoreRole(manageRoles), removeMember);

storeInviteRouter.get('/', requireStoreRole(readRoles), listInvites);
storeInviteRouter.post('/', inviteLimiter, requireStoreRole(manageRoles), createInvite);
storeInviteRouter.post('/accept', acceptLimiter, acceptInvite);
storeInviteRouter.delete('/:inviteId', requireStoreRole(manageRoles), revokeInvite);
