import { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { AuthRequest } from '../../middlewares/auth';
import { ingredientCreateSchema, ingredientUpdateSchema } from './ingredient.schemas';
import { ingredientService } from './ingredient.service';

export const listIngredients = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const ingredients = await ingredientService.list(storeId);
    res.status(200).json({ ingredients });
});

export const getIngredient = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const ingredientId = req.params.ingredientId;
    if (!storeId || !ingredientId) {
        throw new AppError('BAD_REQUEST', 'Store and ingredient are required', 400);
    }

    const ingredient = await ingredientService.get(storeId, ingredientId);
    res.status(200).json({ ingredient });
});

export const createIngredient = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const payload = ingredientCreateSchema.parse(req.body);
    const ingredient = await ingredientService.create(storeId, payload);
    res.status(201).json({ ingredient });
});

export const updateIngredient = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const ingredientId = req.params.ingredientId;
    if (!storeId || !ingredientId) {
        throw new AppError('BAD_REQUEST', 'Store and ingredient are required', 400);
    }

    const payload = ingredientUpdateSchema.parse(req.body);
    const ingredient = await ingredientService.update(storeId, ingredientId, payload);
    res.status(200).json({ ingredient });
});

export const deleteIngredient = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const ingredientId = req.params.ingredientId;
    if (!storeId || !ingredientId) {
        throw new AppError('BAD_REQUEST', 'Store and ingredient are required', 400);
    }

    await ingredientService.remove(storeId, ingredientId);
    res.status(204).send();
});
