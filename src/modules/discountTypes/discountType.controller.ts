import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import {
    discountTypeCreateSchema,
    discountTypeListQuerySchema,
    discountTypeUpdateSchema,
} from './discountType.schemas';
import { discountTypeService } from './discountType.service';

const context = (req: AuthRequest) => {
    const storeId = req.params.storeId;
    const userId = req.user?.sub;
    if (!storeId || !userId) {
        throw new AppError('UNAUTHORIZED', 'Missing store or user context', 401);
    }
    return { storeId, userId };
};

export const listDiscountTypes = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId } = context(req);
    const query = discountTypeListQuerySchema.parse(req.query);
    const discountTypes = await discountTypeService.list(storeId, query.includeArchived);
    res.status(200).json({ discountTypes });
});

export const createDiscountType = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, userId } = context(req);
    const input = discountTypeCreateSchema.parse(req.body);
    const discountType = await discountTypeService.create(storeId, userId, input);
    res.status(201).json({ discountType });
});

export const updateDiscountType = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, userId } = context(req);
    const input = discountTypeUpdateSchema.parse(req.body);
    const discountType = await discountTypeService.update(storeId, userId, req.params.discountTypeId, input);
    res.status(200).json({ discountType });
});

export const archiveDiscountType = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, userId } = context(req);
    await discountTypeService.archive(storeId, userId, req.params.discountTypeId);
    res.status(204).send();
});
