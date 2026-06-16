import { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { AuthRequest } from '../../middlewares/auth';
import { aiService } from './ai.service';
import { chatSchema } from './ai.schemas';

export const generateDailySummary = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.sub;
    const storeId = req.params.storeId;
    if (!userId) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
        return;
    }
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const result = await aiService.generateDailySummary(storeId);
    res.status(200).json(result);
});

export const chat = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.sub;
    const storeId = req.params.storeId;
    if (!userId) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
        return;
    }
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const { messages } = chatSchema.parse(req.body);
    const result = await aiService.chat(storeId, messages);
    res.status(200).json(result);
});

export const reorderPlan = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.sub;
    const storeId = req.params.storeId;
    if (!userId) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
        return;
    }
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const result = await aiService.generateReorderPlan(storeId);
    res.status(200).json(result);
});
