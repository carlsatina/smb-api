import { McpTokenAccess, Prisma, Role } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { membershipSelect } from '../../middlewares/requireStoreRole';

type Tx = Prisma.TransactionClient;

export const tokenSelect = {
    id: true,
    name: true,
    access: true,
    tokenPrefix: true,
    lastUsedAt: true,
    expiresAt: true,
    createdAt: true,
    stores: { select: { store: { select: { id: true, name: true, deletedAt: true } } } },
} satisfies Prisma.McpTokenSelect;

export type TokenRow = Prisma.McpTokenGetPayload<{ select: typeof tokenSelect }>;

/** Not revoked and not past its expiry. */
const activeWhere = (now = new Date()): Prisma.McpTokenWhereInput => ({
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

const auditTokenEvent = (
    tx: Tx,
    storeIds: string[],
    actorId: string,
    action: string,
    token: { id: string; name: string; access: McpTokenAccess },
    extra: Record<string, unknown> = {}
) =>
    tx.auditLog.createMany({
        data: storeIds.map((storeId) => ({
            storeId,
            actorId,
            action,
            entityType: 'McpToken',
            entityId: token.id,
            meta: { name: token.name, access: token.access, storeCount: storeIds.length, ...extra } as Prisma.InputJsonValue,
        })),
    });

export const mcpTokenRepository = {
    listActiveByUser: (userId: string) =>
        prisma.mcpToken.findMany({
            where: { userId, ...activeWhere() },
            orderBy: { createdAt: 'desc' },
            select: tokenSelect,
        }),

    getPasswordHash: async (userId: string) =>
        (await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }))?.passwordHash ?? null,

    /** Store ids, out of the requested ones, that the user currently owns. */
    findOwnedStoreIds: async (userId: string, storeIds: string[]) => {
        const owned = await prisma.storeMember.findMany({
            where: {
                userId,
                storeId: { in: storeIds },
                role: Role.OWNER,
                deletedAt: null,
                suspendedAt: null,
                store: { deletedAt: null },
            },
            select: { storeId: true },
        });
        return owned.map((member) => member.storeId);
    },

    /**
     * Creates the token unless the user is at the limit. A per-user advisory lock
     * makes the count-then-create atomic, so parallel requests can't exceed it.
     */
    createWithinLimit: (input: {
        userId: string;
        name: string;
        access: McpTokenAccess;
        tokenHash: string;
        tokenPrefix: string;
        expiresAt: Date | null;
        storeIds: string[];
        limit: number;
    }) =>
        prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mcp-token:${input.userId}`}))`;
            const activeCount = await tx.mcpToken.count({ where: { userId: input.userId, ...activeWhere() } });
            if (activeCount >= input.limit) return null;

            const created = await tx.mcpToken.create({
                data: {
                    userId: input.userId,
                    name: input.name,
                    access: input.access,
                    tokenHash: input.tokenHash,
                    tokenPrefix: input.tokenPrefix,
                    expiresAt: input.expiresAt,
                    stores: { create: input.storeIds.map((storeId) => ({ storeId })) },
                },
                select: tokenSelect,
            });
            await auditTokenEvent(tx, input.storeIds, input.userId, 'MCP_TOKEN_CREATED', created, {
                expiresAt: input.expiresAt?.toISOString() ?? null,
            });
            return created;
        }),

    /** Returns false when the user has no such active token. */
    revoke: (userId: string, tokenId: string) =>
        prisma.$transaction(async (tx) => {
            const token = await tx.mcpToken.findFirst({
                where: { id: tokenId, userId, revokedAt: null },
                select: { id: true, name: true, access: true, stores: { select: { storeId: true } } },
            });
            if (!token) return false;
            await tx.mcpToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
            await auditTokenEvent(tx, token.stores.map((s) => s.storeId), userId, 'MCP_TOKEN_REVOKED', token);
            return true;
        }),

    /**
     * Revokes every token the user has, e.g. when their password changes, so a
     * token minted from a compromised session doesn't outlive the reset.
     */
    revokeAllForUser: async (tx: Tx, userId: string, reason: string) => {
        const tokens = await tx.mcpToken.findMany({
            where: { userId, revokedAt: null },
            select: { id: true, name: true, access: true, stores: { select: { storeId: true } } },
        });
        if (tokens.length === 0) return;
        await tx.mcpToken.updateMany({ where: { id: { in: tokens.map((t) => t.id) } }, data: { revokedAt: new Date() } });
        for (const token of tokens) {
            await auditTokenEvent(tx, token.stores.map((s) => s.storeId), userId, 'MCP_TOKEN_REVOKED', token, { reason });
        }
    },

    findByHash: (tokenHash: string) =>
        prisma.mcpToken.findUnique({
            where: { tokenHash },
            select: {
                id: true,
                name: true,
                access: true,
                userId: true,
                revokedAt: true,
                expiresAt: true,
                lastUsedAt: true,
                stores: {
                    where: { store: { deletedAt: null } },
                    select: { store: { select: { id: true, name: true, storeType: true, currency: true } } },
                    orderBy: { store: { createdAt: 'asc' } },
                },
            },
        }),

    touchLastUsed: (tokenId: string) => prisma.mcpToken.update({ where: { id: tokenId }, data: { lastUsedAt: new Date() } }),

    /** The user's memberships in the given stores, in one query. */
    membershipsFor: (userId: string, storeIds: string[]) =>
        prisma.storeMember.findMany({
            where: { userId, storeId: { in: storeIds }, deletedAt: null },
            select: membershipSelect,
        }),
};
