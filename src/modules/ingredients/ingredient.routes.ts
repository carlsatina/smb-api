import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
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

const readRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.VIEWER];
const writeRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER];
const adminRoles = [Role.OWNER, Role.ADMIN];

ingredientRouter.use(authMiddleware);
ingredientRouter.use(requirePlanFeature('ingredients'));

ingredientRouter.get('/export', requireStoreRole(adminRoles), requirePlanFeature('importExport'), exportIngredients);
ingredientRouter.post('/import', requireStoreRole(adminRoles), requirePlanFeature('importExport'), csvUploadSingle, importIngredients);
ingredientRouter.get('/', requireStoreRole(readRoles), listIngredients);
ingredientRouter.get('/:ingredientId', requireStoreRole(readRoles), getIngredient);
ingredientRouter.post('/', requireStoreRole(writeRoles), createIngredient);
ingredientRouter.patch('/:ingredientId', requireStoreRole(writeRoles), updateIngredient);
ingredientRouter.delete('/:ingredientId', requireStoreRole(writeRoles), deleteIngredient);
