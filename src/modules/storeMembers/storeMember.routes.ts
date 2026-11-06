import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { createRateLimiter } from '../../middlewares/rateLimit';
import { requirePermission, requireStoreMember } from '../../middlewares/requirePermission';
import {
    acceptInvite,
    createInvite,
    listInvites,
    listMembers,
    previewInvite,
    removeMember,
    revokeInvite,
    setMemberSuspension,
    updateMemberRole,
} from './storeMember.controller';

export const storeMemberRouter = Router({ mergeParams: true });
export const storeInviteRouter = Router({ mergeParams: true });


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

storeMemberRouter.get('/', requireStoreMember(), listMembers);
storeMemberRouter.patch('/:memberId', requirePermission('store.manage'), updateMemberRole);
storeMemberRouter.patch('/:memberId/suspension', requirePermission('store.manage'), setMemberSuspension);
storeMemberRouter.delete('/:memberId', requirePermission('store.manage'), removeMember);

storeInviteRouter.get('/', requireStoreMember(), listInvites);
storeInviteRouter.post('/', inviteLimiter, requirePermission('store.manage'), createInvite);
storeInviteRouter.post('/accept', acceptLimiter, acceptInvite);
storeInviteRouter.delete('/:inviteId', requirePermission('store.manage'), revokeInvite);
