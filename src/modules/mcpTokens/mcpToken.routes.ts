import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { createMcpToken, listMcpTokens, revokeMcpToken } from './mcpToken.controller';

// Account-level: a token belongs to the signed-in user and can cover several of
// their stores. The service only accepts stores the user owns, since a token
// can read catalog costs and (read & write) change products.
export const mcpTokenRouter = Router();

mcpTokenRouter.use(authMiddleware);

mcpTokenRouter.get('/', listMcpTokens);
mcpTokenRouter.post('/', createMcpToken);
mcpTokenRouter.delete('/:tokenId', revokeMcpToken);
