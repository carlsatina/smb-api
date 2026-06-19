import { IngredientCategory, Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';
import { productPackagingRepository } from './productPackaging.repository';

type PackagingLineInput = {
    ingredientId: string;
    qtyPerUnit: number;
};

const ensureProduct = async (storeId: string, productId: string) => {
    const product = await prisma.product.findFirst({
        where: {
            id: productId,
            storeId,
            deletedAt: null,
        },
        select: {
            id: true,
        },
    });

    if (!product) {
        throw new AppError('NOT_FOUND', 'Product not found', 404);
    }

    return product;
};

const mapLines = (lines: Awaited<ReturnType<typeof productPackagingRepository.listByProduct>>) =>
    lines.map((line) => ({
        id: line.id,
        ingredientId: line.ingredientId,
        qtyPerUnit: line.qtyPerUnit,
        ingredient: line.ingredient
            ? {
                  id: line.ingredient.id,
                  name: line.ingredient.name,
                  unit: line.ingredient.unit,
                  category: line.ingredient.category,
                  costPerUnit: line.ingredient.costPerUnit,
                  active: line.ingredient.active,
                  deletedAt: line.ingredient.deletedAt,
              }
            : null,
    }));

const validateIngredients = async (storeId: string, lines: PackagingLineInput[]) => {
    const ingredientIds = lines.map((line) => line.ingredientId);
    const uniqueIngredientIds = Array.from(new Set(ingredientIds));

    if (uniqueIngredientIds.length !== ingredientIds.length) {
        throw new AppError('DUPLICATE_INGREDIENT', 'Each packaging item can only appear once', 400);
    }

    if (uniqueIngredientIds.length === 0) {
        return;
    }

    const ingredients = await prisma.ingredient.findMany({
        where: {
            storeId,
            deletedAt: null,
            id: { in: uniqueIngredientIds },
        },
        select: { id: true, category: true },
    });

    if (ingredients.length !== uniqueIngredientIds.length) {
        throw new AppError('INGREDIENT_NOT_FOUND', 'One or more packaging items are missing', 404);
    }

    const nonPackaging = ingredients.find((i) => i.category !== IngredientCategory.PACKAGING);
    if (nonPackaging) {
        throw new AppError(
            'INVALID_PACKAGING_INGREDIENT',
            'Packaging lines must reference ingredients in the Packaging category',
            400
        );
    }
};

export const productPackagingService = {
    listLines: async (storeId: string, productId: string) => {
        await ensureProduct(storeId, productId);
        const lines = await productPackagingRepository.listByProduct(productId);
        return mapLines(lines);
    },
    replaceLines: async (storeId: string, productId: string, lines: PackagingLineInput[]) => {
        await ensureProduct(storeId, productId);
        await validateIngredients(storeId, lines);

        const formattedLines = lines.map((line) => ({
            ingredientId: line.ingredientId,
            qtyPerUnit: new Prisma.Decimal(line.qtyPerUnit),
        }));

        await prisma.$transaction(async (tx) => {
            await productPackagingRepository.deleteByProduct(productId, tx);
            if (formattedLines.length > 0) {
                await productPackagingRepository.createLines(productId, formattedLines, tx);
            }
        });

        const updated = await productPackagingRepository.listByProduct(productId);
        return mapLines(updated);
    },
};
