import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePermission } from '../../middlewares/requirePermission';
import { createSupplier, deleteSupplier, getSupplier, listSuppliers, updateSupplier } from './supplier.controller';

export const supplierRouter = Router({ mergeParams: true });


supplierRouter.use(authMiddleware);

supplierRouter.get('/', requirePermission('inventory.view'), listSuppliers);
supplierRouter.get('/:supplierId', requirePermission('inventory.view'), getSupplier);
supplierRouter.post('/', requirePermission('inventory.manage'), createSupplier);
supplierRouter.patch('/:supplierId', requirePermission('inventory.manage'), updateSupplier);
supplierRouter.delete('/:supplierId', requirePermission('inventory.manage'), deleteSupplier);
