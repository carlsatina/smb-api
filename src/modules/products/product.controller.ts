import { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { AuthRequest } from '../../middlewares/auth';
import { productCreateSchema, productUpdateSchema } from './product.schemas';
import { productService } from './product.service';

export const listProducts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const products = await productService.list(storeId);
    res.status(200).json({ products });
});

export const getProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const productId = req.params.productId;
    if (!storeId || !productId) {
        throw new AppError('BAD_REQUEST', 'Store and product are required', 400);
    }

    const product = await productService.get(storeId, productId);
    res.status(200).json({ product });
});

export const createProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const payload = productCreateSchema.parse(req.body);
    const { recipeLines, ...productData } = payload;
    const product = await productService.create(storeId, productData, recipeLines);
    res.status(201).json({ product });
});

export const updateProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const productId = req.params.productId;
    if (!storeId || !productId) {
        throw new AppError('BAD_REQUEST', 'Store and product are required', 400);
    }

    const payload = productUpdateSchema.parse(req.body);
    const { recipeLines, ...productData } = payload;
    const product = await productService.update(storeId, productId, productData, recipeLines);
    res.status(200).json({ product });
});

export const deleteProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const productId = req.params.productId;
    if (!storeId || !productId) {
        throw new AppError('BAD_REQUEST', 'Store and product are required', 400);
    }

    await productService.remove(storeId, productId);
    res.status(204).send();
});
