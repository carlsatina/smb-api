import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requirePermission } from '../../middlewares/requirePermission';
import {
    createPurchaseOrder,
    getPurchaseOrder,
    getPurchaseReceipt,
    getPurchaseReceiptSummary,
    listPurchaseReceipts,
    listPurchaseOrders,
    receivePurchaseOrder,
    updatePurchaseOrder,
} from './purchaseOrder.controller';

export const purchaseOrderRouter = Router({ mergeParams: true });


purchaseOrderRouter.use(authMiddleware);
purchaseOrderRouter.use(requirePlanFeature('purchaseOrders'));

purchaseOrderRouter.get('/', requirePermission('inventory.view'), listPurchaseOrders);
purchaseOrderRouter.get('/receipts/summary', requirePermission('inventory.view'), getPurchaseReceiptSummary);
purchaseOrderRouter.get('/receipts', requirePermission('inventory.view'), listPurchaseReceipts);
purchaseOrderRouter.get('/receipts/:receiptId', requirePermission('inventory.view'), getPurchaseReceipt);
purchaseOrderRouter.get('/:purchaseOrderId', requirePermission('inventory.view'), getPurchaseOrder);
purchaseOrderRouter.post('/', requirePermission('inventory.manage'), createPurchaseOrder);
purchaseOrderRouter.patch('/:purchaseOrderId', requirePermission('inventory.manage'), updatePurchaseOrder);
purchaseOrderRouter.post('/:purchaseOrderId/receive', requirePermission('inventory.manage'), receivePurchaseOrder);
