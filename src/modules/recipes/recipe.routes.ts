import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { listRecipeLines, updateRecipeLines } from './recipe.controller';

export const recipeRouter = Router({ mergeParams: true });

const readRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.VIEWER];
const writeRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER];

recipeRouter.use(authMiddleware);
recipeRouter.use(requirePlanFeature('recipes'));

recipeRouter.get('/', requireStoreRole(readRoles), listRecipeLines);
recipeRouter.put('/', requireStoreRole(writeRoles), updateRecipeLines);
