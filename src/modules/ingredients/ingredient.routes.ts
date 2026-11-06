import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
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


ingredientRouter.use(authMiddleware);
ingredientRouter.use(requirePlanFeature('ingredients'));

ingredientRouter.get('/export', requirePermission('inventory.manage'), requirePlanFeature('importExport'), exportIngredients);
ingredientRouter.post('/import', requirePermission('inventory.manage'), requirePlanFeature('importExport'), csvUploadSingle, importIngredients);
ingredientRouter.get('/', requirePermission('inventory.view'), listIngredients);
ingredientRouter.get('/:ingredientId', requirePermission('inventory.view'), getIngredient);
ingredientRouter.post('/', requirePermission('inventory.manage'), createIngredient);
ingredientRouter.patch('/:ingredientId', requirePermission('inventory.manage'), updateIngredient);
ingredientRouter.delete('/:ingredientId', requirePermission('inventory.manage'), deleteIngredient);
