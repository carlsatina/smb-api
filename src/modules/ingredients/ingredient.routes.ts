import { Role } from '@prisma/client';
import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { requirePermission } from '../../middlewares/requirePermission';
import { csvUploadSingle } from '../../middlewares/csvUpload';
import {
    createIngredient,
    deleteIngredient,
    exportIngredients,
    getIngredient,
    importIngredients,
    listIngredients,
    updateIngredient,
} from './ingredient.controller';

export const ingredientRouter = Router({ mergeParams: true });

// Bulk catalog import/export (includes costs) stays with owners and admins who
// can manage products & stock; it isn't delegable through the permissions grid.
const catalogCsvGuard = [requireStoreRole([Role.OWNER, Role.ADMIN]), requirePermission('inventory.manage')];


ingredientRouter.use(authMiddleware);
ingredientRouter.use(requirePlanFeature('ingredients'));

ingredientRouter.get('/export', ...catalogCsvGuard, requirePlanFeature('importExport'), exportIngredients);
ingredientRouter.post('/import', ...catalogCsvGuard, requirePlanFeature('importExport'), csvUploadSingle, importIngredients);
ingredientRouter.get('/', requirePermission('inventory.view'), listIngredients);
ingredientRouter.get('/:ingredientId', requirePermission('inventory.view'), getIngredient);
ingredientRouter.post('/', requirePermission('inventory.manage'), createIngredient);
ingredientRouter.patch('/:ingredientId', requirePermission('inventory.manage'), updateIngredient);
ingredientRouter.delete('/:ingredientId', requirePermission('inventory.manage'), deleteIngredient);
