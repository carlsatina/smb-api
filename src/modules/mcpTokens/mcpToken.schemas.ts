import { McpTokenAccess } from '@prisma/client';
import { z } from 'zod';

export const mcpTokenCreateSchema = z.object({
    name: z.string().trim().min(1).max(60),
    access: z.nativeEnum(McpTokenAccess).default(McpTokenAccess.READ_ONLY),
    storeIds: z.array(z.string().min(1)).min(1, 'Pick at least one store.').max(50),
});
