import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import {
    createPurchaseOrderSchema,
    purchaseOrderListQuerySchema,
    purchaseReceiptListQuerySchema,
    purchaseReceiptSummaryQuerySchema,
    receivePurchaseOrderSchema,
    updatePurchaseOrderSchema,
} from './purchaseOrder.schemas';
import { purchaseOrderService } from './purchaseOrder.service';

export const listPurchaseOrders = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = purchaseOrderListQuerySchema.parse(req.query);
    const data = await purchaseOrderService.list(
        storeId,
        {
            status: query.status,
            search: query.q,
            from: query.from,
            to: query.to,
            supplierId: query.supplierId,
            supplierName: query.supplierName,
        },
        query.page,
        query.pageSize
    );
    res.status(200).json(data);
});

export const getPurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const purchaseOrderId = req.params.purchaseOrderId;
    if (!storeId || !purchaseOrderId) {
        throw new AppError('BAD_REQUEST', 'Store and purchase order are required', 400);
    }

    const purchaseOrder = await purchaseOrderService.get(storeId, purchaseOrderId);
    res.status(200).json({ purchaseOrder });
});

export const getPurchaseReceipt = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const receiptId = req.params.receiptId;
    if (!storeId || !receiptId) {
        throw new AppError('BAD_REQUEST', 'Store and receipt are required', 400);
    }

    const receipt = await purchaseOrderService.getReceipt(storeId, receiptId);
    res.status(200).json({ receipt });
});

export const listPurchaseReceipts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = purchaseReceiptListQuerySchema.parse(req.query);
    const result = await purchaseOrderService.listReceipts(
        storeId,
        {
            search: query.q,
            from: query.from,
            to: query.to,
            supplierId: query.supplierId,
            supplierName: query.supplierName,
        },
        query.page,
        query.pageSize
    );
    res.status(200).json(result);
});

export const getPurchaseReceiptSummary = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = purchaseReceiptSummaryQuerySchema.parse(req.query);
    const summary = await purchaseOrderService.getReceiptSummary(storeId, {
        from: query.from,
        to: query.to,
        supplierId: query.supplierId,
        supplierName: query.supplierName,
    });
    res.status(200).json({ summary });
});

export const createPurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const payload = createPurchaseOrderSchema.parse(req.body);
    const purchaseOrder = await purchaseOrderService.create(storeId, payload);
    res.status(201).json({ purchaseOrder });
});

export const updatePurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const purchaseOrderId = req.params.purchaseOrderId;
    const userId = req.user?.sub;
    if (!storeId || !purchaseOrderId) {
        throw new AppError('BAD_REQUEST', 'Store and purchase order are required', 400);
    }

    const payload = updatePurchaseOrderSchema.parse(req.body);
    const purchaseOrder = await purchaseOrderService.update(storeId, userId, purchaseOrderId, payload);
    res.status(200).json({ purchaseOrder });
});

export const receivePurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const purchaseOrderId = req.params.purchaseOrderId;
    const userId = req.user?.sub;

    if (!storeId || !purchaseOrderId || !userId) {
        throw new AppError('BAD_REQUEST', 'Store, purchase order, and user are required', 400);
    }

    const payload = receivePurchaseOrderSchema.parse(req.body);
    const result = await purchaseOrderService.receive(storeId, userId, purchaseOrderId, payload);
    res.status(201).json(result);
});
