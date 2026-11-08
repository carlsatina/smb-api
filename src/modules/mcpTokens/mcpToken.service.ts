import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { McpTokenAccess } from '@prisma/client';
import { AppError } from '../../shared/errors';
import { mcpTokenRepository, TokenRow } from './mcpToken.repository';

// Recognisable prefix so leaked tokens are easy to spot in logs and secret scanners.
export const MCP_TOKEN_PREFIX = 'smbpos_mcp_';
const MAX_ACTIVE_TOKENS_PER_USER = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export const hashMcpToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Archived stores drop out of the list; the token keeps working for the rest.
const tokenOut = (token: TokenRow) => ({
    id: token.id,
    name: token.name,
    access: token.access,
    tokenPrefix: token.tokenPrefix,
    lastUsedAt: token.lastUsedAt,
    expiresAt: token.expiresAt,
    createdAt: token.createdAt,
    stores: token.stores
        .filter(({ store }) => !store.deletedAt)
        .map(({ store }) => ({ id: store.id, name: store.name })),
});

export const mcpTokenService = {
    list: async (userId: string) => (await mcpTokenRepository.listActiveByUser(userId)).map(tokenOut),

    /** Returns the plaintext token once; only its hash is stored. */
    create: async (
        userId: string,
        input: { name: string; access: McpTokenAccess; storeIds: string[]; expiresInDays: number | null; password: string }
    ) => {
        // Re-authenticate: a hijacked session alone can't mint a long-lived credential.
        const passwordHash = await mcpTokenRepository.getPasswordHash(userId);
        if (!passwordHash || !(await bcrypt.compare(input.password, passwordHash))) {
            throw new AppError('INVALID_PASSWORD', 'Incorrect password.', 403);
        }

        // Tokens can only cover stores the user currently owns.
        const storeIds = [...new Set(input.storeIds)];
        const owned = await mcpTokenRepository.findOwnedStoreIds(userId, storeIds);
        if (owned.length !== storeIds.length) {
            throw new AppError('FORBIDDEN', 'You can only connect stores you own.', 403);
        }

        const secret = `${MCP_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
        const token = await mcpTokenRepository.createWithinLimit({
            userId,
            name: input.name,
            access: input.access,
            tokenHash: hashMcpToken(secret),
            tokenPrefix: secret.slice(0, MCP_TOKEN_PREFIX.length + 4),
            expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * DAY_MS) : null,
            storeIds,
            limit: MAX_ACTIVE_TOKENS_PER_USER,
        });
        if (!token) {
            throw new AppError(
                'MCP_TOKEN_LIMIT',
                `You can have at most ${MAX_ACTIVE_TOKENS_PER_USER} active tokens. Revoke one first.`,
                409
            );
        }

        return { token: tokenOut(token), secret };
    },

    revoke: async (userId: string, tokenId: string) => {
        if (!(await mcpTokenRepository.revoke(userId, tokenId))) {
            throw new AppError('NOT_FOUND', 'Token not found', 404);
        }
    },
};
