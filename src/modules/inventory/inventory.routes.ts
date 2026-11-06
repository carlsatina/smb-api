import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePermission } from '../../middlewares/requirePermission';
import { batchTransferStock, createStockAdjustment, listMovements, listStock, transferStock } from './inventory.controller';

export const inventoryRouter = Router({ mergeParams: true });


inventoryRouter.use(authMiddleware);

inventoryRouter.get('/stock', requirePermission('inventory.view', 'pos.use'), listStock);
inventoryRouter.get('/movements', requirePermission('inventory.view', 'pos.use'), listMovements);
inventoryRouter.post('/adjustments', requirePermission('inventory.manage'), createStockAdjustment);
inventoryRouter.post('/transfers', requirePermission('inventory.manage'), transferStock);
inventoryRouter.post('/transfers/batch', requirePermission('inventory.manage'), batchTransferStock);
