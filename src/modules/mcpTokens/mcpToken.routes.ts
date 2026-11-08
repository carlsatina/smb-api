import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { createRateLimiter } from '../../middlewares/rateLimit';
import { AuthRequest } from '../../middlewares/auth';
import { createMcpToken, listMcpTokens, revokeMcpToken } from './mcpToken.controller';

// Account-level: a token belongs to the signed-in user and can cover several of
// their stores. The service only accepts stores the user owns, since a token
// can read catalog costs and (read & write) change products.
export const mcpTokenRouter = Router();

// Creating a token checks the password, so cap attempts per user.
const createLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many token requests. Please try again later.',
    keyGenerator: (req) => `mcp-token-create:${(req as AuthRequest).user?.sub ?? req.ip}`,
});

mcpTokenRouter.use(authMiddleware);

mcpTokenRouter.get('/', listMcpTokens);
mcpTokenRouter.post('/', createLimiter, createMcpToken);
mcpTokenRouter.delete('/:tokenId', revokeMcpToken);
