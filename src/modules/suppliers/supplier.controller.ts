import { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { AuthRequest } from '../../middlewares/auth';
import { supplierCreateSchema, supplierUpdateSchema } from './supplier.schemas';
import { supplierService } from './supplier.service';

export const listSuppliers = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const suppliers = await supplierService.list(storeId);
    res.status(200).json({ suppliers });
});

export const getSupplier = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const supplierId = req.params.supplierId;
    if (!storeId || !supplierId) {
        throw new AppError('BAD_REQUEST', 'Store and supplier are required', 400);
    }

    const supplier = await supplierService.get(storeId, supplierId);
    res.status(200).json({ supplier });
});

export const createSupplier = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const payload = supplierCreateSchema.parse(req.body);
    const supplier = await supplierService.create(storeId, payload);
    res.status(201).json({ supplier });
});

export const updateSupplier = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const supplierId = req.params.supplierId;
    if (!storeId || !supplierId) {
        throw new AppError('BAD_REQUEST', 'Store and supplier are required', 400);
    }

    const payload = supplierUpdateSchema.parse(req.body);
    const userId = req.user?.sub;
    const supplier = await supplierService.update(storeId, supplierId, payload, userId);
    res.status(200).json({ supplier });
});

export const deleteSupplier = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const supplierId = req.params.supplierId;
    if (!storeId || !supplierId) {
        throw new AppError('BAD_REQUEST', 'Store and supplier are required', 400);
    }

    await supplierService.remove(storeId, supplierId);
    res.status(204).send();
});
