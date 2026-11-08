import { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { AuthRequest } from '../../middlewares/auth';
import { mcpTokenCreateSchema } from './mcpToken.schemas';
import { mcpTokenService } from './mcpToken.service';

const requireUserId = (req: AuthRequest) => {
    const userId = req.user?.sub;
    if (!userId) throw new AppError('UNAUTHORIZED', 'Missing user context', 401);
    return userId;
};

export const listMcpTokens = asyncHandler(async (req: AuthRequest, res: Response) => {
    const tokens = await mcpTokenService.list(requireUserId(req));
    res.status(200).json({ tokens });
});

export const createMcpToken = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = requireUserId(req);
    const payload = mcpTokenCreateSchema.parse(req.body);
    const { token, secret } = await mcpTokenService.create(userId, payload);
    res.status(201).json({ token, secret });
});

export const revokeMcpToken = asyncHandler(async (req: AuthRequest, res: Response) => {
    await mcpTokenService.revoke(requireUserId(req), req.params.tokenId);
    res.status(204).send();
});
