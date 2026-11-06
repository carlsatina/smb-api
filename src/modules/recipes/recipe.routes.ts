import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requirePermission } from '../../middlewares/requirePermission';
import { listRecipeLines, updateRecipeLines } from './recipe.controller';

export const recipeRouter = Router({ mergeParams: true });


recipeRouter.use(authMiddleware);
recipeRouter.use(requirePlanFeature('recipes'));

recipeRouter.get('/', requirePermission('inventory.view'), listRecipeLines);
recipeRouter.put('/', requirePermission('inventory.manage'), updateRecipeLines);
