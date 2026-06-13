import { Router } from 'express';
import { Role } from '@prisma/client';
import multer from 'multer';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
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

const csvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    },
});

ingredientRouter.use(authMiddleware);
ingredientRouter.use(requirePlanFeature('ingredients'));

ingredientRouter.get('/export', requireStoreRole(adminRoles), requirePlanFeature('importExport'), exportIngredients);
ingredientRouter.post('/import', requireStoreRole(adminRoles), requirePlanFeature('importExport'), csvUpload.single('file'), importIngredients);
ingredientRouter.get('/', requireStoreRole(readRoles), listIngredients);
ingredientRouter.get('/:ingredientId', requireStoreRole(readRoles), getIngredient);
ingredientRouter.post('/', requireStoreRole(writeRoles), createIngredient);
ingredientRouter.patch('/:ingredientId', requireStoreRole(writeRoles), updateIngredient);
ingredientRouter.delete('/:ingredientId', requireStoreRole(writeRoles), deleteIngredient);
