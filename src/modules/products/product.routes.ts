import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import {
    createProduct,
    deleteProduct,
    getProduct,
    listProducts,
    updateProduct,
} from './product.controller';

export const productRouter = Router({ mergeParams: true });

const readRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.CASHIER, Role.VIEWER];
const writeRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER];

productRouter.use(authMiddleware);

productRouter.get('/', requireStoreRole(readRoles), listProducts);
productRouter.get('/:productId', requireStoreRole(readRoles), getProduct);
productRouter.post('/', requireStoreRole(writeRoles), createProduct);
productRouter.patch('/:productId', requireStoreRole(writeRoles), updateProduct);
productRouter.delete('/:productId', requireStoreRole(writeRoles), deleteProduct);
