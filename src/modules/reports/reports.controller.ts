import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import prisma from '../../../lib/prisma';
import { hasPermission } from '../../middlewares/requirePermission';
import { escapeCsvValue } from '../../shared/csv';
import {
    reportDiscountBookQuerySchema,
    reportIngredientUsageQuerySchema,
    reportLowStockQuerySchema,
    reportMarginQuerySchema,
    reportRangeSchema,
    reportProductsSoldQuerySchema,
    reportPurchaseSpendQuerySchema,
    reportSupplyUsageQuerySchema,
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

export const getSupplyUsage = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportSupplyUsageQuerySchema.parse(req.query);
    const data = await reportsService.getSupplyUsage(storeId, query.from, query.to);
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
    const data = await reportsService.getExpenseSummary(storeId, req.permissions, query.from, query.to);
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

export const getSalesByChannel = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportRangeSchema.parse(req.query);
    const data = await reportsService.getSalesByChannel(storeId, query.from, query.to);
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

export const getDiscountBook = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportDiscountBookQuerySchema.parse(req.query);
    const data = await reportsService.getDiscountBook(storeId, {
        ...query,
        revealIds: hasPermission(req, 'discounts.viewHolders'),
    });
    res.status(200).json(data);
});

const formatInZone = (date: Date, timeZone: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
};

export const DISCOUNT_BOOK_CSV_HEADERS = [
    'Date',
    'Time',
    'Receipt #',
    'Discount',
    'Code',
    'Name',
    'ID number',
    'Diners',
    'Gross sales',
    'VAT-exempt sales',
    'VAT removed',
    'Discount amount',
    'Net sales',
];

// Holder IDs are personal data: every export is audit-logged, full IDs only with the permission.
export const exportDiscountBook = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = reportDiscountBookQuerySchema.parse(req.query);
    const revealIds = hasPermission(req, 'discounts.viewHolders');
    const book = await reportsService.getDiscountBook(storeId, { ...query, revealIds });

    const lines = [DISCOUNT_BOOK_CSV_HEADERS.map(escapeCsvValue).join(',')];
    book.entries.forEach((entry) => {
        const { date, time } = formatInZone(new Date(entry.soldAt), book.timeZone);
        lines.push(
            [
                date,
                time,
                entry.receiptNumber,
                entry.name,
                entry.code,
                entry.holderName,
                entry.holderIdNumber,
                entry.dinerCount ? `${entry.holderCount}/${entry.dinerCount}` : '',
                entry.grossSales.toFixed(2),
                entry.vatExemptSales.toFixed(2),
                entry.vatRemoved.toFixed(2),
                entry.discount.toFixed(2),
                entry.netSales.toFixed(2),
            ]
                .map(escapeCsvValue)
                .join(',')
        );
    });
    lines.push(
        [
            'Total',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            book.totals.grossSales.toFixed(2),
            book.totals.vatExemptSales.toFixed(2),
            book.totals.vatRemoved.toFixed(2),
            book.totals.discount.toFixed(2),
            book.totals.netSales.toFixed(2),
        ]
            .map(escapeCsvValue)
            .join(',')
    );

    await prisma.auditLog.create({
        data: {
            storeId,
            actorId: req.user?.sub ?? null,
            action: 'DISCOUNT_BOOK_EXPORTED',
            entityType: 'Report',
            meta: {
                from: book.range.from,
                to: book.range.to,
                codes: query.codes,
                rows: book.entries.length,
                idsRevealed: revealIds,
            },
        },
    });

    const filename = `discount-book-${book.range.from}-to-${book.range.to}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(lines.join('\n'));
});
