import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { createStockAdjustment, listMovements, listStock } from './inventory.controller';

export const inventoryRouter = Router({ mergeParams: true });

const readRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.VIEWER];
const writeRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER];

inventoryRouter.use(authMiddleware);

inventoryRouter.get('/stock', requireStoreRole(readRoles), listStock);
inventoryRouter.get('/movements', requireStoreRole(readRoles), listMovements);
inventoryRouter.post('/adjustments', requireStoreRole(writeRoles), createStockAdjustment);
