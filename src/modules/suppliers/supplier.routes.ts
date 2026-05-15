import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { createSupplier, deleteSupplier, getSupplier, listSuppliers, updateSupplier } from './supplier.controller';

export const supplierRouter = Router({ mergeParams: true });

const readRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.VIEWER];
const writeRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER];

supplierRouter.use(authMiddleware);
supplierRouter.use(requirePlanFeature('purchaseOrders'));

supplierRouter.get('/', requireStoreRole(readRoles), listSuppliers);
supplierRouter.get('/:supplierId', requireStoreRole(readRoles), getSupplier);
supplierRouter.post('/', requireStoreRole(writeRoles), createSupplier);
supplierRouter.patch('/:supplierId', requireStoreRole(writeRoles), updateSupplier);
supplierRouter.delete('/:supplierId', requireStoreRole(writeRoles), deleteSupplier);
