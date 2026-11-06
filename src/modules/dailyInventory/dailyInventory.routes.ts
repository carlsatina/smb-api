import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { requireUserFeature } from '../../middlewares/requireUserFeature';
import { getDailyReport, saveDailyReport } from './dailyInventory.controller';

export const dailyInventoryRouter = Router({ mergeParams: true });


dailyInventoryRouter.use(authMiddleware);
// Customer-specific report, gated by the DAILY_SALES user feature; kept on a fixed
// role rule rather than in the Roles & permissions grid.
dailyInventoryRouter.use(requireStoreRole([Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.CASHIER]));
dailyInventoryRouter.use(requireUserFeature('DAILY_SALES'));

dailyInventoryRouter.get('/', getDailyReport);
dailyInventoryRouter.post('/', saveDailyReport);
