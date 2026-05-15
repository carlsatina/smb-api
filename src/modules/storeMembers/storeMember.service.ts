import crypto from 'crypto';
import { Role } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { env } from '../../config/env';
import { getPlanConfig } from '../../config/plans';
import { AppError } from '../../shared/errors';
import { sendInviteEmail } from '../../shared/email';

type InviteInput = {
    email: string;
    role: Role;
    expiresInDays?: number;
};

const hashToken = (token: string) => {
    return crypto.createHash('sha256').update(token).digest('hex');
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const ensureStoreExists = async (storeId: string) => {
    const store = await prisma.store.findFirst({
        where: {
            id: storeId,
            deletedAt: null,
        },
        select: { id: true, name: true },
    });

    if (!store) {
        throw new AppError('NOT_FOUND', 'Store not found', 404);
    }

    return store;
};

const getActorRole = async (storeId: string, userId: string) => {
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
        throw new AppError('FORBIDDEN', 'Not a store member', 403);
    }

    return membership.role;
};

const ensureOwnerRemaining = async (storeId: string, excludeMemberId: string) => {
    const owners = await prisma.storeMember.count({
        where: {
            storeId,
            role: Role.OWNER,
            deletedAt: null,
            NOT: {
                id: excludeMemberId,
            },
        },
    });

    if (owners === 0) {
        throw new AppError('OWNER_REQUIRED', 'At least one owner must remain on the store.', 400);
    }
};

const getStorePlanOwner = async (storeId: string) => {
    const owner = await prisma.storeMember.findFirst({
        where: {
            storeId,
            role: Role.OWNER,
            deletedAt: null,
        },
        orderBy: {
            createdAt: 'asc',
        },
        select: {
            user: {
                select: {
                    planTier: true,
                    subscriptionActive: true,
                },
            },
        },
    });

    if (!owner?.user) {
        throw new AppError('OWNER_REQUIRED', 'Store owner not found.', 400);
    }

    return owner.user;
};

const ensureMemberCapacity = async (storeId: string, includeInvites: boolean) => {
    const owner = await getStorePlanOwner(storeId);
    if (!owner.subscriptionActive) {
        throw new AppError('SUBSCRIPTION_REQUIRED', 'Active subscription required to manage members.', 403);
    }

    const plan = getPlanConfig(owner.planTier);
    const memberCount = await prisma.storeMember.count({
        where: {
            storeId,
            deletedAt: null,
        },
    });
    const inviteCount = includeInvites
        ? await prisma.storeInvite.count({
              where: {
                  storeId,
                  acceptedAt: null,
                  expiresAt: {
                      gt: new Date(),
                  },
              },
          })
        : 0;

    if (memberCount + inviteCount >= plan.maxUsersPerStore) {
        throw new AppError(
            'PLAN_LIMIT',
            `${plan.label} plan allows up to ${plan.maxUsersPerStore} users per store.`,
            403
        );
    }
};

export const storeMemberService = {
    listMembers: async (storeId: string) => {
        const store = await ensureStoreExists(storeId);
        const members = await prisma.storeMember.findMany({
            where: {
                storeId,
                deletedAt: null,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'asc',
            },
        });

        return members.map((member) => ({
            id: member.id,
            userId: member.userId,
            fullName: member.user.fullName,
            email: member.user.email,
            role: member.role,
            createdAt: member.createdAt,
        }));
    },
    updateMemberRole: async (storeId: string, memberId: string, role: Role, actorId: string) => {
        const actorRole = await getActorRole(storeId, actorId);

        if (role === Role.OWNER && actorRole !== Role.OWNER) {
            throw new AppError('FORBIDDEN', 'Only owners can assign the owner role.', 403);
        }

        const member = await prisma.storeMember.findFirst({
            where: {
                id: memberId,
                storeId,
                deletedAt: null,
            },
        });

        if (!member) {
            throw new AppError('NOT_FOUND', 'Store member not found', 404);
        }

        if (member.role === Role.OWNER && role !== Role.OWNER && actorRole !== Role.OWNER) {
            throw new AppError('FORBIDDEN', 'Only owners can change another owner role.', 403);
        }

        if (member.role === Role.OWNER && role !== Role.OWNER) {
            await ensureOwnerRemaining(storeId, member.id);
        }

        const updateResult = await prisma.storeMember.updateMany({
            where: {
                id: member.id,
                storeId,
                deletedAt: null,
            },
            data: { role },
        });

        if (updateResult.count === 0) {
            throw new AppError('NOT_FOUND', 'Store member not found', 404);
        }

        const updated = await prisma.storeMember.findFirst({
            where: {
                id: member.id,
                storeId,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                    },
                },
            },
        });

        if (!updated) {
            throw new AppError('NOT_FOUND', 'Store member not found', 404);
        }

        return {
            id: updated.id,
            userId: updated.userId,
            fullName: updated.user.fullName,
            email: updated.user.email,
            role: updated.role,
            createdAt: updated.createdAt,
        };
    },
    removeMember: async (storeId: string, memberId: string, actorId: string) => {
        const actorRole = await getActorRole(storeId, actorId);
        const member = await prisma.storeMember.findFirst({
            where: {
                id: memberId,
                storeId,
                deletedAt: null,
            },
        });

        if (!member) {
            throw new AppError('NOT_FOUND', 'Store member not found', 404);
        }

        if (member.role === Role.OWNER && actorRole !== Role.OWNER) {
            throw new AppError('FORBIDDEN', 'Only owners can remove another owner.', 403);
        }

        if (member.role === Role.OWNER) {
            await ensureOwnerRemaining(storeId, member.id);
        }

        const updateResult = await prisma.storeMember.updateMany({
            where: {
                id: member.id,
                storeId,
                deletedAt: null,
            },
            data: { deletedAt: new Date() },
        });

        if (updateResult.count === 0) {
            throw new AppError('NOT_FOUND', 'Store member not found', 404);
        }
    },
    listInvites: async (storeId: string) => {
        await ensureStoreExists(storeId);
        const invites = await prisma.storeInvite.findMany({
            where: {
                storeId,
            },
            include: {
                invitedBy: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        const now = new Date();
        return invites.map((invite) => {
            const status = invite.acceptedAt
                ? 'ACCEPTED'
                : invite.expiresAt <= now
                  ? 'EXPIRED'
                  : 'PENDING';
            return {
                id: invite.id,
                email: invite.email,
                role: invite.role,
                status,
                expiresAt: invite.expiresAt,
                acceptedAt: invite.acceptedAt,
                createdAt: invite.createdAt,
                invitedBy: invite.invitedBy,
            };
        });
    },
    createInvite: async (storeId: string, actorId: string, input: InviteInput) => {
        const actorRole = await getActorRole(storeId, actorId);
        const store = await ensureStoreExists(storeId);

        if (input.role === Role.OWNER && actorRole !== Role.OWNER) {
            throw new AppError('FORBIDDEN', 'Only owners can invite another owner.', 403);
        }

        const email = normalizeEmail(input.email);
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            const existingMember = await prisma.storeMember.findFirst({
                where: {
                    storeId,
                    userId: existingUser.id,
                    deletedAt: null,
                },
            });
            if (existingMember) {
                throw new AppError('ALREADY_MEMBER', 'User is already a member of this store.', 409);
            }
        }

        const pendingInvite = await prisma.storeInvite.findFirst({
            where: {
                storeId,
                email,
                acceptedAt: null,
                expiresAt: {
                    gt: new Date(),
                },
            },
        });

        if (pendingInvite) {
            throw new AppError('INVITE_EXISTS', 'An active invite already exists for this email.', 409);
        }

        await ensureMemberCapacity(storeId, true);

        const token = crypto.randomBytes(24).toString('hex');
        const tokenHash = hashToken(token);
        const expiresInDays = input.expiresInDays ?? 7;
        const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

        const invite = await prisma.storeInvite.create({
            data: {
                storeId,
                email,
                role: input.role,
                tokenHash,
                expiresAt,
                invitedById: actorId,
            },
            include: {
                invitedBy: {
                    select: { id: true, fullName: true, email: true },
                },
            },
        });

        let emailSent = false;
        try {
            const inviter = invite.invitedBy?.fullName || invite.invitedBy?.email || null;
            const inviteLink = `${env.appBaseUrl}/stores/${storeId}/invites/accept?token=${token}`;
            const result = await sendInviteEmail({
                to: invite.email,
                storeName: store.name,
                role: invite.role,
                invitedBy: inviter,
                inviteLink,
                expiresAt: invite.expiresAt,
            });
            emailSent = result.sent;
        } catch (error) {
            emailSent = false;
        }

        return {
            invite: {
                id: invite.id,
                email: invite.email,
                role: invite.role,
                status: 'PENDING',
                expiresAt: invite.expiresAt,
                acceptedAt: invite.acceptedAt,
                createdAt: invite.createdAt,
                invitedBy: invite.invitedBy,
            },
            token,
            emailSent,
        };
    },
    revokeInvite: async (storeId: string, inviteId: string) => {
        const invite = await prisma.storeInvite.findFirst({
            where: {
                id: inviteId,
                storeId,
            },
        });

        if (!invite) {
            throw new AppError('NOT_FOUND', 'Invite not found', 404);
        }

        const deleteResult = await prisma.storeInvite.deleteMany({
            where: {
                id: inviteId,
                storeId,
            },
        });

        if (deleteResult.count === 0) {
            throw new AppError('NOT_FOUND', 'Invite not found', 404);
        }
    },
    acceptInvite: async (storeId: string, userId: string, email: string, token: string) => {
        await ensureStoreExists(storeId);
        const tokenHash = hashToken(token);
        const invite = await prisma.storeInvite.findFirst({
            where: {
                storeId,
                tokenHash,
            },
        });

        if (!invite) {
            throw new AppError('INVALID_INVITE', 'Invite not found', 404);
        }

        if (invite.acceptedAt) {
            throw new AppError('INVITE_USED', 'Invite has already been accepted.', 409);
        }

        if (invite.expiresAt <= new Date()) {
            throw new AppError('INVITE_EXPIRED', 'Invite has expired.', 410);
        }

        if (normalizeEmail(invite.email) !== normalizeEmail(email)) {
            throw new AppError('INVITE_EMAIL_MISMATCH', 'Invite email does not match your account.', 403);
        }

        const existingMember = await prisma.storeMember.findFirst({
            where: {
                storeId,
                userId,
                deletedAt: null,
            },
        });

        if (existingMember) {
            throw new AppError('ALREADY_MEMBER', 'You are already a member of this store.', 409);
        }

        await ensureMemberCapacity(storeId, false);

        const membership = await prisma.$transaction(async (tx) => {
            const member = await tx.storeMember.create({
                data: {
                    storeId,
                    userId,
                    role: invite.role,
                },
            });

            const updateResult = await tx.storeInvite.updateMany({
                where: {
                    id: invite.id,
                    storeId,
                },
                data: { acceptedAt: new Date() },
            });

            if (updateResult.count === 0) {
                throw new AppError('INVALID_INVITE', 'Invite not found', 404);
            }

            return member;
        });

        return membership;
    },
};
