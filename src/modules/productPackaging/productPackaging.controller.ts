import { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { AuthRequest } from '../../middlewares/auth';
import { packagingLinesUpdateSchema } from './productPackaging.schemas';
import { productPackagingService } from './productPackaging.service';

export const listPackagingLines = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const productId = req.params.productId;
    if (!storeId || !productId) {
        throw new AppError('BAD_REQUEST', 'Store and product are required', 400);
    }

    const lines = await productPackagingService.listLines(storeId, productId);
    res.status(200).json({ lines });
});

export const updatePackagingLines = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const productId = req.params.productId;
    if (!storeId || !productId) {
        throw new AppError('BAD_REQUEST', 'Store and product are required', 400);
    }

    const payload = packagingLinesUpdateSchema.parse(req.body);
    const lines = await productPackagingService.replaceLines(storeId, productId, payload.lines);
    res.status(200).json({ lines });
});
