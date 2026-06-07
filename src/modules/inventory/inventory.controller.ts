import { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { AuthRequest } from '../../middlewares/auth';
import {
    batchTransferStockSchema,
    inventoryMovementQuerySchema,
    inventoryStockQuerySchema,
    stockAdjustmentSchema,
    transferStockSchema,
} from './inventory.schemas';
import { inventoryService } from './inventory.service';

export const listStock = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = inventoryStockQuerySchema.parse(req.query);
    const stock = await inventoryService.getStock(storeId, query.itemType, query.itemId);
    res.status(200).json({ stock });
});

export const listMovements = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = inventoryMovementQuerySchema.parse(req.query);
    const result = await inventoryService.listMovements(
        storeId,
        {
            itemType: query.itemType,
            itemId: query.itemId,
            type: query.type,
            createdById: query.createdById,
            from: query.from,
            to: query.to,
        },
        query.page,
        query.pageSize
    );

    res.status(200).json(result);
});

export const createStockAdjustment = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const payload = stockAdjustmentSchema.parse(req.body);
    const movement = await inventoryService.createAdjustment(storeId, req.user?.sub, payload);
    res.status(201).json({ movement });
});

export const transferStock = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const payload = transferStockSchema.parse(req.body);
    const result = await inventoryService.transferStock(storeId, req.user?.sub, payload);
    res.status(201).json(result);
});

export const batchTransferStock = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const payload = batchTransferStockSchema.parse(req.body);
    const result = await inventoryService.batchTransferStock(storeId, req.user?.sub, payload);
    res.status(201).json(result);
});
