import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { requirePermission } from '../../middlewares/requirePermission';
import {
    createStore,
    deleteStore,
    getRolePermissions,
    listAiModels,
    listStores,
    testAiConnection,
    updateAiSettings,
    updateRolePermissions,
    updateStore,
} from './store.controller';

export const storeRouter = Router();

// NOTE: This router is mounted at `/api/v1/stores`, which is a path prefix of the
// store-scoped sub-routers (e.g. `/api/v1/stores/:storeId/invites`). Applying auth
// via `storeRouter.use(authMiddleware)` would run it against ALL of those prefixed
// paths before they fall through to their own routers — which 401s otherwise-public
// routes like `GET /invites/preview`. Apply auth per-route instead so it only guards
// this router's own endpoints.
storeRouter.get('/', authMiddleware, listStores);
storeRouter.post('/', authMiddleware, createStore);
storeRouter.patch('/:storeId', authMiddleware, requirePermission('store.manage'), updateStore);
storeRouter.patch('/:storeId/ai-settings', authMiddleware, requirePermission('store.manage'), updateAiSettings);
storeRouter.post('/:storeId/ai-settings/test', authMiddleware, requirePermission('store.manage'), testAiConnection);
storeRouter.get('/:storeId/ai-settings/models', authMiddleware, requirePermission('store.manage'), listAiModels);
storeRouter.delete('/:storeId', authMiddleware, requireStoreRole([Role.OWNER]), deleteStore);
// Anyone who manages the store can see the grid; only owners can change it (never delegable).
storeRouter.get('/:storeId/permissions', authMiddleware, requirePermission('store.manage'), getRolePermissions);
storeRouter.put('/:storeId/permissions', authMiddleware, requireStoreRole([Role.OWNER]), updateRolePermissions);
