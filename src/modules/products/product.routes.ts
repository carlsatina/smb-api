import { Role } from '@prisma/client';
import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { requirePermission } from '../../middlewares/requirePermission';
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

// Bulk catalog import/export (includes costs) stays with owners and admins who
// can manage products & stock; it isn't delegable through the permissions grid.
const catalogCsvGuard = [requireStoreRole([Role.OWNER, Role.ADMIN]), requirePermission('inventory.manage')];


productRouter.use(authMiddleware);

productRouter.get('/export', ...catalogCsvGuard, requirePlanFeature('importExport'), exportProducts);
productRouter.post('/import', ...catalogCsvGuard, requirePlanFeature('importExport'), csvUploadSingle, importProducts);
productRouter.get('/', requirePermission('inventory.view', 'pos.use'), listProducts);
productRouter.get('/:productId', requirePermission('inventory.view', 'pos.use'), getProduct);
productRouter.post('/', requirePermission('inventory.manage'), createProduct);
productRouter.patch('/:productId', requirePermission('inventory.manage'), updateProduct);
productRouter.delete('/:productId', requirePermission('inventory.manage'), deleteProduct);
