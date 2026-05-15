import { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { createStoreSchema, updateStoreSchema } from './store.schemas';
import { storeService } from './store.service';
import { AuthRequest } from '../../middlewares/auth';
import { AppError } from '../../shared/errors';

export const listStores = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.sub;
    if (!userId) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
        return;
    }

    const stores = await storeService.listStores(userId);
    res.status(200).json({ stores });
});

export const createStore = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.sub;
    if (!userId) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
        return;
    }

    const payload = createStoreSchema.parse(req.body);
    const store = await storeService.createStore(userId, payload);
    res.status(201).json({ store });
});

export const updateStore = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.sub;
    const storeId = req.params.storeId;
    if (!userId) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
        return;
    }
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const payload = updateStoreSchema.parse(req.body);
    const store = await storeService.updateStore(storeId, payload);
    if (!store) {
        throw new AppError('NOT_FOUND', 'Store not found', 404);
    }
    res.status(200).json({ store });
});

export const deleteStore = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.sub;
    const storeId = req.params.storeId;
    if (!userId) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
        return;
    }
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const store = await storeService.deleteStore(storeId);
    if (!store) {
        throw new AppError('NOT_FOUND', 'Store not found', 404);
    }

    res.status(200).json({ storeId: store.id });
});
