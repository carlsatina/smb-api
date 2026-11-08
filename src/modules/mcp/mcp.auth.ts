import { McpTokenAccess, Role, StoreType } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';
import { AuthRequest } from '../../middlewares/auth';
import { loadStoreMembership } from '../../middlewares/requireStoreRole';
import { hashMcpToken, MCP_TOKEN_PREFIX } from '../mcpTokens/mcpToken.service';

export type McpStore = { id: string; name: string; storeType: StoreType; currency: string };

export type McpContext = {
    tokenId: string;
    tokenName: string;
    access: McpTokenAccess;
    userId: string;
    /** Stores on the token that the user still owns, checked on this request. */
    stores: McpStore[];
};

// lastUsedAt is informational, so skip the write when it was touched recently.
const LAST_USED_REFRESH_MS = 60 * 1000;

/**
 * Runs the same membership check every app route uses (member suspension,
 * billing read-only lock, effective permissions) as the token's owner.
 * `method` decides whether the billing lock applies: GET for reads, POST for writes.
 */
const checkMembership = async (userId: string, storeId: string, method: 'GET' | 'POST') => {
    const req = {
        params: { storeId },
        user: { sub: userId, email: '' },
        method,
    } as unknown as AuthRequest;
    const role = await loadStoreMembership(req);
    // Tokens are issued by owners; a store they no longer own drops off the token.
    if (role !== Role.OWNER) {
        throw new AppError('FORBIDDEN', 'You no longer own this store.', 403);
    }
    return req.permissions ?? [];
};

export const resolveMcpToken = async (authorization: string | undefined): Promise<McpContext> => {
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);
    const raw = match?.[1];
    if (!raw || !raw.startsWith(MCP_TOKEN_PREFIX)) {
        throw new AppError('MCP_TOKEN_REQUIRED', 'Send an SMB-PoS MCP token as "Authorization: Bearer <token>".', 401);
    }

    const token = await prisma.mcpToken.findUnique({
        where: { tokenHash: hashMcpToken(raw) },
        select: {
            id: true,
            name: true,
            access: true,
            userId: true,
            revokedAt: true,
            lastUsedAt: true,
            stores: {
                where: { store: { deletedAt: null } },
                select: { store: { select: { id: true, name: true, storeType: true, currency: true } } },
                orderBy: { store: { createdAt: 'asc' } },
            },
        },
    });
    if (!token || token.revokedAt) {
        throw new AppError('MCP_TOKEN_INVALID', 'This MCP token is invalid or has been revoked.', 401);
    }

    // Keep only the stores the owner can still access; the token works as long as one remains.
    const checks = await Promise.all(
        token.stores.map(({ store }) =>
            checkMembership(token.userId, store.id, 'GET').then(
                () => store,
                () => null
            )
        )
    );
    const stores = checks.filter((store): store is McpStore => store !== null);
    if (stores.length === 0) {
        throw new AppError('MCP_TOKEN_INVALID', 'This MCP token no longer has access to any store.', 401);
    }

    if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > LAST_USED_REFRESH_MS) {
        await prisma.mcpToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
    }

    return {
        tokenId: token.id,
        tokenName: token.name,
        access: token.access,
        userId: token.userId,
        stores,
    };
};

/**
 * Picks the store a tool call targets. With a single store the id is optional,
 * so one-store owners never have to think about it.
 */
export const resolveStore = (context: McpContext, storeId: string | undefined): McpStore => {
    if (!storeId) {
        if (context.stores.length === 1) return context.stores[0];
        throw new AppError('STORE_REQUIRED', 'This token covers several stores. Pass storeId (see list_stores).', 400);
    }
    const store = context.stores.find((s) => s.id === storeId);
    if (!store) {
        throw new AppError('FORBIDDEN', 'This token does not have access to that store. Use list_stores to see which it covers.', 403);
    }
    return store;
};

/** Called by every write tool right before it changes anything. */
export const assertCanWrite = async (context: McpContext, storeId: string) => {
    if (context.access !== McpTokenAccess.READ_WRITE) {
        throw new AppError('MCP_READ_ONLY', 'This token is read-only.', 403);
    }
    const permissions = await checkMembership(context.userId, storeId, 'POST');
    if (!permissions.includes('inventory.manage')) {
        throw new AppError('FORBIDDEN', "Your role doesn't have permission to do this.", 403);
    }
};
