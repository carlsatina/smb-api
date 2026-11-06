import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requirePermission } from '../../middlewares/requirePermission';
import { listPackagingLines, updatePackagingLines } from './productPackaging.controller';

export const productPackagingRouter = Router({ mergeParams: true });


productPackagingRouter.use(authMiddleware);
productPackagingRouter.use(requirePlanFeature('ingredients'));

productPackagingRouter.get('/', requirePermission('inventory.view'), listPackagingLines);
productPackagingRouter.put('/', requirePermission('inventory.manage'), updatePackagingLines);
