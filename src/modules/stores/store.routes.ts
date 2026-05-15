import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { createStore, deleteStore, listStores, updateStore } from './store.controller';

export const storeRouter = Router();

storeRouter.use(authMiddleware);

storeRouter.get('/', listStores);
storeRouter.post('/', createStore);
storeRouter.patch('/:storeId', requireStoreRole([Role.OWNER, Role.ADMIN]), updateStore);
storeRouter.delete('/:storeId', requireStoreRole([Role.OWNER]), deleteStore);
