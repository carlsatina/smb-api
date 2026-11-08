import { createHash, randomBytes } from 'crypto';
import { McpTokenAccess, Prisma, Role } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';

// Recognisable prefix so leaked tokens are easy to spot in logs and secret scanners.
export const MCP_TOKEN_PREFIX = 'smbpos_mcp_';
const MAX_ACTIVE_TOKENS_PER_USER = 10;

export const hashMcpToken = (token: string) => createHash('sha256').update(token).digest('hex');

const tokenSelect = {
    id: true,
    name: true,
    access: true,
    tokenPrefix: true,
    lastUsedAt: true,
    createdAt: true,
    stores: { select: { store: { select: { id: true, name: true, deletedAt: true } } } },
} satisfies Prisma.McpTokenSelect;

type TokenRow = Prisma.McpTokenGetPayload<{ select: typeof tokenSelect }>;

// Archived stores drop out of the list; the token keeps working for the rest.
const tokenOut = (token: TokenRow) => ({
    id: token.id,
    name: token.name,
    access: token.access,
    tokenPrefix: token.tokenPrefix,
    lastUsedAt: token.lastUsedAt,
    createdAt: token.createdAt,
    stores: token.stores
        .filter(({ store }) => !store.deletedAt)
        .map(({ store }) => ({ id: store.id, name: store.name })),
});

const auditAll = (
    tx: Prisma.TransactionClient,
    storeIds: string[],
    actorId: string,
    action: string,
    token: { id: string; name: string; access: McpTokenAccess }
) =>
    tx.auditLog.createMany({
        data: storeIds.map((storeId) => ({
            storeId,
            actorId,
            action,
            entityType: 'McpToken',
            entityId: token.id,
            meta: { name: token.name, access: token.access, storeCount: storeIds.length },
        })),
    });

export const mcpTokenService = {
    list: async (userId: string) => {
        const tokens = await prisma.mcpToken.findMany({
            where: { userId, revokedAt: null },
            orderBy: { createdAt: 'desc' },
            select: tokenSelect,
        });
        return tokens.map(tokenOut);
    },

    /** Returns the plaintext token once; only its hash is stored. */
    create: async (userId: string, input: { name: string; access: McpTokenAccess; storeIds: string[] }) => {
        const storeIds = [...new Set(input.storeIds)];

        // Tokens can only cover stores the user currently owns.
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
        if (owned.length !== storeIds.length) {
            throw new AppError('FORBIDDEN', 'You can only connect stores you own.', 403);
        }

        const activeCount = await prisma.mcpToken.count({ where: { userId, revokedAt: null } });
        if (activeCount >= MAX_ACTIVE_TOKENS_PER_USER) {
            throw new AppError(
                'MCP_TOKEN_LIMIT',
                `You can have at most ${MAX_ACTIVE_TOKENS_PER_USER} active tokens. Revoke one first.`,
                409
            );
        }

        const secret = `${MCP_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
        const token = await prisma.$transaction(async (tx) => {
            const created = await tx.mcpToken.create({
                data: {
                    userId,
                    name: input.name,
                    access: input.access,
                    tokenHash: hashMcpToken(secret),
                    tokenPrefix: secret.slice(0, MCP_TOKEN_PREFIX.length + 4),
                    stores: { create: storeIds.map((storeId) => ({ storeId })) },
                },
                select: tokenSelect,
            });
            await auditAll(tx, storeIds, userId, 'MCP_TOKEN_CREATED', created);
            return created;
        });

        return { token: tokenOut(token), secret };
    },

    revoke: async (userId: string, tokenId: string) => {
        await prisma.$transaction(async (tx) => {
            const token = await tx.mcpToken.findFirst({
                where: { id: tokenId, userId, revokedAt: null },
                select: { id: true, name: true, access: true, stores: { select: { storeId: true } } },
            });
            if (!token) {
                throw new AppError('NOT_FOUND', 'Token not found', 404);
            }
            await tx.mcpToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
            await auditAll(tx, token.stores.map((s) => s.storeId), userId, 'MCP_TOKEN_REVOKED', token);
        });
    },
};
