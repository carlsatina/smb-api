import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { saleFinalizeSchema, saleListQuerySchema } from './sale.schemas';
import { saleService } from './sale.service';

export const listSales = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = saleListQuerySchema.parse(req.query);
    const data = await saleService.list(
        storeId,
        {
            status: query.status,
            from: query.from,
            to: query.to,
            cashierId: query.cashierId,
            paymentMethod: query.paymentMethod,
            productId: query.productId,
        },
        query.page,
        query.pageSize
    );
    res.status(200).json(data);
});

export const getSale = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const saleId = req.params.saleId;
    if (!storeId || !saleId) {
        throw new AppError('BAD_REQUEST', 'Store and sale are required', 400);
    }

    const sale = await saleService.get(storeId, saleId);
    res.status(200).json({ sale });
});

export const finalizeSale = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const userId = req.user?.sub;
    if (!storeId || !userId) {
        throw new AppError('UNAUTHORIZED', 'Missing store or user context', 401);
    }

    const payload = saleFinalizeSchema.parse(req.body);
    const sale = await saleService.finalize(storeId, userId, payload);
    res.status(201).json({ sale });
});

export const voidSale = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const saleId = req.params.saleId;
    const userId = req.user?.sub;

    if (!storeId || !saleId || !userId) {
        throw new AppError('BAD_REQUEST', 'Store, sale, and user are required', 400);
    }

    const sale = await saleService.voidSale(storeId, userId, saleId);
    res.status(200).json({ sale });
});
