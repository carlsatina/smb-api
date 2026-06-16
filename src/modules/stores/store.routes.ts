import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { createStore, deleteStore, listAiModels, listStores, testAiConnection, updateAiSettings, updateStore } from './store.controller';

export const storeRouter = Router();

// NOTE: This router is mounted at `/api/v1/stores`, which is a path prefix of the
// store-scoped sub-routers (e.g. `/api/v1/stores/:storeId/invites`). Applying auth
// via `storeRouter.use(authMiddleware)` would run it against ALL of those prefixed
// paths before they fall through to their own routers — which 401s otherwise-public
// routes like `GET /invites/preview`. Apply auth per-route instead so it only guards
// this router's own endpoints.
storeRouter.get('/', authMiddleware, listStores);
storeRouter.post('/', authMiddleware, createStore);
storeRouter.patch('/:storeId', authMiddleware, requireStoreRole([Role.OWNER, Role.ADMIN]), updateStore);
storeRouter.patch('/:storeId/ai-settings', authMiddleware, requireStoreRole([Role.OWNER, Role.ADMIN]), updateAiSettings);
storeRouter.post('/:storeId/ai-settings/test', authMiddleware, requireStoreRole([Role.OWNER, Role.ADMIN]), testAiConnection);
storeRouter.get('/:storeId/ai-settings/models', authMiddleware, requireStoreRole([Role.OWNER, Role.ADMIN]), listAiModels);
storeRouter.delete('/:storeId', authMiddleware, requireStoreRole([Role.OWNER]), deleteStore);
