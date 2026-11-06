import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
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


productRouter.use(authMiddleware);

productRouter.get('/export', requirePermission('inventory.manage'), requirePlanFeature('importExport'), exportProducts);
productRouter.post('/import', requirePermission('inventory.manage'), requirePlanFeature('importExport'), csvUploadSingle, importProducts);
productRouter.get('/', requirePermission('inventory.view', 'pos.use'), listProducts);
productRouter.get('/:productId', requirePermission('inventory.view', 'pos.use'), getProduct);
productRouter.post('/', requirePermission('inventory.manage'), createProduct);
productRouter.patch('/:productId', requirePermission('inventory.manage'), updateProduct);
productRouter.delete('/:productId', requirePermission('inventory.manage'), deleteProduct);
