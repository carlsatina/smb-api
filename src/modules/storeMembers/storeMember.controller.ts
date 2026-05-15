import { Response } from 'express';
import { Role } from '@prisma/client';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import {
    acceptInviteSchema,
    createInviteSchema,
    updateMemberRoleSchema,
} from './storeMember.schemas';
import { storeMemberService } from './storeMember.service';

export const listMembers = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const members = await storeMemberService.listMembers(storeId);
    res.status(200).json({ members });
});

export const updateMemberRole = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const memberId = req.params.memberId;
    const actorId = req.user?.sub;
    if (!storeId || !memberId || !actorId) {
        throw new AppError('STORE_REQUIRED', 'Store and member are required', 400);
    }

    const payload = updateMemberRoleSchema.parse(req.body);
    const member = await storeMemberService.updateMemberRole(storeId, memberId, payload.role as Role, actorId);
    res.status(200).json({ member });
});

export const removeMember = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const memberId = req.params.memberId;
    const actorId = req.user?.sub;
    if (!storeId || !memberId || !actorId) {
        throw new AppError('STORE_REQUIRED', 'Store and member are required', 400);
    }

    await storeMemberService.removeMember(storeId, memberId, actorId);
    res.status(204).send();
});

export const listInvites = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const invites = await storeMemberService.listInvites(storeId);
    res.status(200).json({ invites });
});

export const createInvite = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const actorId = req.user?.sub;
    if (!storeId || !actorId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const payload = createInviteSchema.parse(req.body);
    const result = await storeMemberService.createInvite(storeId, actorId, {
        email: payload.email,
        role: payload.role,
        expiresInDays: payload.expiresInDays,
    });
    res.status(201).json(result);
});

export const revokeInvite = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const inviteId = req.params.inviteId;
    if (!storeId || !inviteId) {
        throw new AppError('STORE_REQUIRED', 'Store and invite are required', 400);
    }

    await storeMemberService.revokeInvite(storeId, inviteId);
    res.status(204).send();
});

export const acceptInvite = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const actorId = req.user?.sub;
    const actorEmail = req.user?.email;
    if (!storeId || !actorId || !actorEmail) {
        throw new AppError('STORE_REQUIRED', 'Store and user are required', 400);
    }

    const payload = acceptInviteSchema.parse(req.body);
    const membership = await storeMemberService.acceptInvite(storeId, actorId, actorEmail, payload.token);
    res.status(201).json({ membership });
});
