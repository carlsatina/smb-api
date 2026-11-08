import { McpTokenAccess } from '@prisma/client';
import { z } from 'zod';

export const MCP_TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;

export const mcpTokenCreateSchema = z.object({
    name: z.string().trim().min(1).max(60),
    access: z.nativeEnum(McpTokenAccess).default(McpTokenAccess.READ_ONLY),
    storeIds: z.array(z.string().min(1)).min(1, 'Pick at least one store.').max(50),
    // null = never expires; owners must choose that explicitly.
    expiresInDays: z
        .union([z.literal(30), z.literal(90), z.literal(365), z.null()])
        .default(90),
    password: z.string().min(1, 'Enter your password.').max(200),
});
