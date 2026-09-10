import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { requireUserFeature } from '../../middlewares/requireUserFeature';
import { getDailyReport, saveDailyReport } from './dailyInventory.controller';

export const dailyInventoryRouter = Router({ mergeParams: true });

const allowedRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.CASHIER];

dailyInventoryRouter.use(authMiddleware);
dailyInventoryRouter.use(requireStoreRole(allowedRoles));
dailyInventoryRouter.use(requireUserFeature('DAILY_SALES'));

dailyInventoryRouter.get('/', getDailyReport);
dailyInventoryRouter.post('/', saveDailyReport);
