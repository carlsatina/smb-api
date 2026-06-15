import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import {
    reportIngredientUsageQuerySchema,
    reportLowStockQuerySchema,
    reportMarginQuerySchema,
    reportRangeSchema,
    reportProductsSoldQuerySchema,
    reportPurchaseSpendQuerySchema,
    reportSalesByHourQuerySchema,
    reportSalesSummaryQuerySchema,
    reportTopProductsQuerySchema,
} from './reports.schemas';

import { reportsService } from './reports.service';

export const getSalesSummary = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportSalesSummaryQuerySchema.parse(req.query);
    const data = await reportsService.getSalesSummary(storeId, query.from, query.to);
    res.status(200).json(data);
});

export const getSalesByDay = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportRangeSchema.parse(req.query);
    const data = await reportsService.getSalesByDay(storeId, query.from, query.to);
    res.status(200).json(data);
});

export const getSalesByHour = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportSalesByHourQuerySchema.parse(req.query);
    const data = await reportsService.getSalesByHour(storeId, query.from, query.to);
    res.status(200).json(data);
});

export const getTopProducts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportTopProductsQuerySchema.parse(req.query);
    const data = await reportsService.getTopProducts(storeId, query.from, query.to, query.limit);
    res.status(200).json(data);
});

export const getLowStock = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportLowStockQuerySchema.parse(req.query);
    const data = await reportsService.getLowStock(storeId, query.limit);
    res.status(200).json(data);
});

export const getIngredientUsage = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportIngredientUsageQuerySchema.parse(req.query);
    const data = await reportsService.getIngredientUsage(storeId, query.from, query.to, query.limit);
    res.status(200).json(data);
});

export const getPurchaseSpend = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportPurchaseSpendQuerySchema.parse(req.query);
    const data = await reportsService.getPurchaseSpend(storeId, query.from, query.to, query.limit);
    res.status(200).json(data);
});

export const getProfitSummary = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportRangeSchema.parse(req.query);
    const data = await reportsService.getProfitSummary(storeId, query.from, query.to);
    res.status(200).json(data);
});

export const getExpenseSummary = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportRangeSchema.parse(req.query);
    const data = await reportsService.getExpenseSummary(storeId, req.storeRole, query.from, query.to);
    res.status(200).json(data);
});

export const getProductsSold = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportProductsSoldQuerySchema.parse(req.query);
    const data = await reportsService.getProductsSold(storeId, query.from, query.to, query.limit);
    res.status(200).json(data);
});

export const getProductMargins = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportMarginQuerySchema.parse(req.query);
    const data = await reportsService.getProductMargins(storeId, query.from, query.to, query.limit);
    res.status(200).json(data);
});

export const getPaymentMethodBreakdown = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportRangeSchema.parse(req.query);
    const data = await reportsService.getPaymentMethodBreakdown(storeId, query.from, query.to);
    res.status(200).json(data);
});

export const getEmployeeSales = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportRangeSchema.parse(req.query);
    const data = await reportsService.getEmployeeSales(storeId, query.from, query.to);
    res.status(200).json(data);
});
