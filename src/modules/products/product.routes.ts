import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { csvUploadSingle } from '../../middlewares/csvUpload';
import {
    createProduct,
    deleteProduct,
    exportProducts,
    getProduct,
    importProducts,
    listProducts,
    updateProduct,
} from './product.controller';

export const productRouter = Router({ mergeParams: true });

const readRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.CASHIER, Role.VIEWER];
const writeRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER];
const adminRoles = [Role.OWNER, Role.ADMIN];

productRouter.use(authMiddleware);

productRouter.get('/export', requireStoreRole(adminRoles), requirePlanFeature('importExport'), exportProducts);
productRouter.post('/import', requireStoreRole(adminRoles), requirePlanFeature('importExport'), csvUploadSingle, importProducts);
productRouter.get('/', requireStoreRole(readRoles), listProducts);
productRouter.get('/:productId', requireStoreRole(readRoles), getProduct);
productRouter.post('/', requireStoreRole(writeRoles), createProduct);
productRouter.patch('/:productId', requireStoreRole(writeRoles), updateProduct);
productRouter.delete('/:productId', requireStoreRole(writeRoles), deleteProduct);
