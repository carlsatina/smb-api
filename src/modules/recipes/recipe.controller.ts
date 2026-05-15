import { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { AuthRequest } from '../../middlewares/auth';
import { recipeLinesUpdateSchema } from './recipe.schemas';
import { recipeService } from './recipe.service';

export const listRecipeLines = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const productId = req.params.productId;
    if (!storeId || !productId) {
        throw new AppError('BAD_REQUEST', 'Store and product are required', 400);
    }

    const lines = await recipeService.listLines(storeId, productId);
    res.status(200).json({ lines });
});

export const updateRecipeLines = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const productId = req.params.productId;
    if (!storeId || !productId) {
        throw new AppError('BAD_REQUEST', 'Store and product are required', 400);
    }

    const payload = recipeLinesUpdateSchema.parse(req.body);
    const lines = await recipeService.replaceLines(storeId, productId, payload.lines);
    res.status(200).json({ lines });
});
