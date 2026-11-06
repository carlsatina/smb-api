import { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { createStoreSchema, updateAiSettingsSchema, updateRolePermissionsSchema, updateStoreSchema } from './store.schemas';
import type { EditableRole, PermissionKey } from '../../shared/permissions';
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

export const updateAiSettings = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.sub;
    const storeId = req.params.storeId;
    if (!userId) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
        return;
    }
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const payload = updateAiSettingsSchema.parse(req.body);
    const store = await storeService.updateAiSettings(storeId, payload);
    if (!store) {
        throw new AppError('NOT_FOUND', 'Store not found', 404);
    }
    res.status(200).json({ store });
});

export const testAiConnection = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.sub;
    const storeId = req.params.storeId;
    if (!userId) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
        return;
    }
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const result = await storeService.testAiConnection(storeId);
    res.status(200).json(result);
});

export const listAiModels = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.sub;
    const storeId = req.params.storeId;
    if (!userId) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
        return;
    }
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const result = await storeService.listAiModels(storeId);
    res.status(200).json(result);
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

export const getRolePermissions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    const data = await storeService.getRolePermissions(storeId);
    res.status(200).json({ ...data, canEdit: req.storeRole === 'OWNER' });
});

export const updateRolePermissions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const userId = req.user?.sub;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    if (!userId) throw new AppError('UNAUTHORIZED', 'Unauthorized', 401);
    const { matrix } = updateRolePermissionsSchema.parse(req.body);
    const data = await storeService.updateRolePermissions(
        storeId,
        userId,
        matrix as Partial<Record<EditableRole, PermissionKey[]>>
    );
    res.status(200).json({ ...data, canEdit: true });
});
