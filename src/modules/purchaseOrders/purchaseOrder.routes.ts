import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
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

const readRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.VIEWER];
const writeRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER];

purchaseOrderRouter.use(authMiddleware);
purchaseOrderRouter.use(requirePlanFeature('purchaseOrders'));

purchaseOrderRouter.get('/', requireStoreRole(readRoles), listPurchaseOrders);
purchaseOrderRouter.get('/receipts/summary', requireStoreRole(readRoles), getPurchaseReceiptSummary);
purchaseOrderRouter.get('/receipts', requireStoreRole(readRoles), listPurchaseReceipts);
purchaseOrderRouter.get('/receipts/:receiptId', requireStoreRole(readRoles), getPurchaseReceipt);
purchaseOrderRouter.get('/:purchaseOrderId', requireStoreRole(readRoles), getPurchaseOrder);
purchaseOrderRouter.post('/', requireStoreRole(writeRoles), createPurchaseOrder);
purchaseOrderRouter.patch('/:purchaseOrderId', requireStoreRole(writeRoles), updatePurchaseOrder);
purchaseOrderRouter.post('/:purchaseOrderId/receive', requireStoreRole(writeRoles), receivePurchaseOrder);
