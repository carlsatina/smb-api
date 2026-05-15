import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import {
    createIngredient,
    deleteIngredient,
    getIngredient,
    listIngredients,
    updateIngredient,
} from './ingredient.controller';

export const ingredientRouter = Router({ mergeParams: true });

const readRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.VIEWER];
const writeRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER];

ingredientRouter.use(authMiddleware);
ingredientRouter.use(requirePlanFeature('ingredients'));

ingredientRouter.get('/', requireStoreRole(readRoles), listIngredients);
ingredientRouter.get('/:ingredientId', requireStoreRole(readRoles), getIngredient);
ingredientRouter.post('/', requireStoreRole(writeRoles), createIngredient);
ingredientRouter.patch('/:ingredientId', requireStoreRole(writeRoles), updateIngredient);
ingredientRouter.delete('/:ingredientId', requireStoreRole(writeRoles), deleteIngredient);
