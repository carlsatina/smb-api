import { McpTokenAccess, Role, StoreType } from '@prisma/client';
import { AppError } from '../../shared/errors';
import { BILLING_SUSPENDED_MESSAGE } from '../../shared/billingStatus';
import { PermissionKey } from '../../shared/permissions';
import { evaluateMembership } from '../../middlewares/requireStoreRole';
import { mcpTokenRepository } from '../mcpTokens/mcpToken.repository';
import { hashMcpToken, MCP_TOKEN_PREFIX } from '../mcpTokens/mcpToken.service';

export type McpStore = {
    id: string;
    name: string;
    storeType: StoreType;
    currency: string;
    /** Store is read-only for non-payment: reads work, writes are refused. */
    billingSuspended: boolean;
    permissions: PermissionKey[];
};

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

export const resolveMcpToken = async (authorization: string | undefined): Promise<McpContext> => {
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);
    const raw = match?.[1];
    if (!raw || !raw.startsWith(MCP_TOKEN_PREFIX)) {
        throw new AppError('MCP_TOKEN_REQUIRED', 'Send an SMB-PoS MCP token as "Authorization: Bearer <token>".', 401);
    }

    const token = await mcpTokenRepository.findByHash(hashMcpToken(raw));
    if (!token || token.revokedAt) {
        throw new AppError('MCP_TOKEN_INVALID', 'This MCP token is invalid or has been revoked.', 401);
    }
    if (token.expiresAt && token.expiresAt <= new Date()) {
        throw new AppError('MCP_TOKEN_EXPIRED', 'This MCP token has expired. Create a new one in Settings → MCP server.', 401);
    }

    // One query for all the token's stores, evaluated with the same rules as
    // every app route. Stores the user no longer owns (or is suspended from)
    // drop off; the token works as long as one remains.
    const memberships = await mcpTokenRepository.membershipsFor(
        token.userId,
        token.stores.map(({ store }) => store.id)
    );
    const accessByStore = new Map(memberships.map((m) => [m.storeId, evaluateMembership(m)]));
    const stores: McpStore[] = [];
    for (const { store } of token.stores) {
        const access = accessByStore.get(store.id);
        if (!access || access.memberSuspended || access.role !== Role.OWNER) continue;
        stores.push({ ...store, billingSuspended: access.billingSuspended, permissions: access.permissions });
    }
    if (stores.length === 0) {
        throw new AppError('MCP_TOKEN_INVALID', 'This MCP token no longer has access to any store.', 401);
    }

    if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > LAST_USED_REFRESH_MS) {
        await mcpTokenRepository.touchLastUsed(token.id);
    }

    return { tokenId: token.id, tokenName: token.name, access: token.access, userId: token.userId, stores };
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

/**
 * Called by every write tool right before it changes anything. Membership was
 * checked when this request was authenticated (each request is independent).
 */
export const assertCanWrite = (context: McpContext, store: McpStore, permission: PermissionKey = 'inventory.manage') => {
    if (context.access !== McpTokenAccess.READ_WRITE) {
        throw new AppError('MCP_READ_ONLY', 'This token is read-only.', 403);
    }
    if (store.billingSuspended) {
        throw new AppError('BILLING_SUSPENDED', BILLING_SUSPENDED_MESSAGE, 402);
    }
    if (!store.permissions.includes(permission)) {
        throw new AppError('FORBIDDEN', "Your role doesn't have permission to do this.", 403);
    }
};
