import { Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors';
import { ingredientRepository } from './ingredient.repository';

type IngredientCreateData = Omit<Prisma.IngredientCreateInput, 'store'>;

export const ingredientService = {
    list: async (storeId: string) => {
        return ingredientRepository.listByStore(storeId);
    },
    get: async (storeId: string, ingredientId: string) => {
        const ingredient = await ingredientRepository.getById(storeId, ingredientId);
        if (!ingredient) {
            throw new AppError('NOT_FOUND', 'Ingredient not found', 404);
        }
        return ingredient;
    },
    create: async (storeId: string, data: IngredientCreateData) => {
        try {
            return await ingredientRepository.create(storeId, data);
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new AppError('DUPLICATE', 'Ingredient with same name already exists', 409);
            }
            throw error;
        }
    },
    update: async (storeId: string, ingredientId: string, data: Prisma.IngredientUpdateInput) => {
        try {
            const updated = await ingredientRepository.update(storeId, ingredientId, data);
            if (!updated) {
                throw new AppError('NOT_FOUND', 'Ingredient not found', 404);
            }
            return updated;
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new AppError('DUPLICATE', 'Ingredient with same name already exists', 409);
            }
            throw error;
        }
    },
    remove: async (storeId: string, ingredientId: string) => {
        const deleted = await ingredientRepository.softDelete(storeId, ingredientId);
        if (!deleted) {
            throw new AppError('NOT_FOUND', 'Ingredient not found', 404);
        }
    },
};
