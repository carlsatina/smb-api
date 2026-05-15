import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';
import { ingredientRepository } from '../ingredients/ingredient.repository';
import { recipeRepository } from './recipe.repository';

type RecipeLineInput = {
    ingredientId: string;
    qtyPerProductUnit: number;
};

const ensureRecipeProduct = async (storeId: string, productId: string) => {
    const product = await prisma.product.findFirst({
        where: {
            id: productId,
            storeId,
            deletedAt: null,
        },
        select: {
            id: true,
            type: true,
        },
    });

    if (!product) {
        throw new AppError('NOT_FOUND', 'Product not found', 404);
    }

    if (product.type !== 'RECIPE') {
        throw new AppError('INVALID_PRODUCT_TYPE', 'Recipe lines are only available for recipe products', 400);
    }

    return product;
};

const mapRecipeLines = (recipe: Awaited<ReturnType<typeof recipeRepository.getRecipeWithLines>>) => {
    if (!recipe) {
        return [];
    }
    return recipe.lines.map((line) => ({
        id: line.id,
        ingredientId: line.ingredientId,
        qtyPerProductUnit: line.qtyPerProductUnit,
        ingredient: line.ingredient
            ? {
                  id: line.ingredient.id,
                  name: line.ingredient.name,
                  unit: line.ingredient.unit,
                  costPerUnit: line.ingredient.costPerUnit,
                  active: line.ingredient.active,
                  deletedAt: line.ingredient.deletedAt,
              }
            : null,
    }));
};

const validateIngredients = async (storeId: string, lines: RecipeLineInput[]) => {
    const ingredientIds = lines.map((line) => line.ingredientId);
    const uniqueIngredientIds = Array.from(new Set(ingredientIds));

    if (uniqueIngredientIds.length !== ingredientIds.length) {
        throw new AppError('DUPLICATE_INGREDIENT', 'Each ingredient can only appear once in a recipe', 400);
    }

    if (uniqueIngredientIds.length === 0) {
        return;
    }

    const count = await ingredientRepository.countByIds(storeId, uniqueIngredientIds);
    if (count !== uniqueIngredientIds.length) {
        throw new AppError('INGREDIENT_NOT_FOUND', 'One or more ingredients are missing', 404);
    }
};

export const recipeService = {
    listLines: async (storeId: string, productId: string) => {
        await ensureRecipeProduct(storeId, productId);
        const recipe = await recipeRepository.getRecipeWithLines(storeId, productId);
        return mapRecipeLines(recipe);
    },
    replaceLines: async (storeId: string, productId: string, lines: RecipeLineInput[]) => {
        await ensureRecipeProduct(storeId, productId);
        await validateIngredients(storeId, lines);

        const formattedLines = lines.map((line) => ({
            ingredientId: line.ingredientId,
            qtyPerProductUnit: new Prisma.Decimal(line.qtyPerProductUnit),
        }));

        await prisma.$transaction(async (tx) => {
            const recipe = await recipeRepository.upsertRecipe(storeId, productId, tx);
            await recipeRepository.deleteLines(recipe.id, tx);
            if (formattedLines.length > 0) {
                await recipeRepository.createLines(recipe.id, formattedLines, tx);
            } else {
                const updateResult = await tx.product.updateMany({
                    where: {
                        id: productId,
                        storeId,
                        deletedAt: null,
                    },
                    data: { active: false },
                });

                if (updateResult.count === 0) {
                    throw new AppError('NOT_FOUND', 'Product not found', 404);
                }
            }
        });

        const updated = await recipeRepository.getRecipeWithLines(storeId, productId);
        return mapRecipeLines(updated);
    },
};
