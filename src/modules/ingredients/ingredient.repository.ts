import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';

type IngredientCreateData = Omit<Prisma.IngredientCreateInput, 'store'>;

export const ingredientRepository = {
    listByStore: async (storeId: string) => {
        return prisma.ingredient.findMany({
            where: {
                storeId,
                deletedAt: null,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
    },
    getById: async (storeId: string, ingredientId: string) => {
        return prisma.ingredient.findFirst({
            where: {
                id: ingredientId,
                storeId,
                deletedAt: null,
            },
        });
    },
    create: async (storeId: string, data: IngredientCreateData) => {
        return prisma.ingredient.create({
            data: {
                ...data,
                store: { connect: { id: storeId } },
            },
        });
    },
    update: async (
        storeId: string,
        ingredientId: string,
        data: Parameters<typeof prisma.ingredient.update>[0]['data']
    ) => {
        const updateResult = await prisma.ingredient.updateMany({
            where: {
                id: ingredientId,
                storeId,
                deletedAt: null,
            },
            data: data as Prisma.IngredientUpdateManyMutationInput,
        });

        if (updateResult.count === 0) {
            return null;
        }

        return prisma.ingredient.findFirst({
            where: {
                id: ingredientId,
                storeId,
                deletedAt: null,
            },
        });
    },
    softDelete: async (storeId: string, ingredientId: string) => {
        const updateResult = await prisma.ingredient.updateMany({
            where: {
                id: ingredientId,
                storeId,
                deletedAt: null,
            },
            data: {
                deletedAt: new Date(),
            },
        });

        if (updateResult.count === 0) {
            return null;
        }

        return prisma.ingredient.findFirst({
            where: {
                id: ingredientId,
                storeId,
            },
        });
    },
    /** Recipe and packaging lines (on live products) that would deduct this ingredient per sale. */
    countProductUsage: async (storeId: string, ingredientId: string) => {
        const [recipeLines, packagingLines] = await Promise.all([
            prisma.recipeLine.count({
                where: {
                    ingredientId,
                    recipe: { storeId, deletedAt: null, product: { deletedAt: null } },
                },
            }),
            prisma.productPackaging.count({
                where: { ingredientId, product: { storeId, deletedAt: null } },
            }),
        ]);
        return recipeLines + packagingLines;
    },
    listCategoriesByIds: async (storeId: string, ingredientIds: string[]) => {
        if (ingredientIds.length === 0) {
            return [];
        }
        return prisma.ingredient.findMany({
            where: {
                storeId,
                deletedAt: null,
                id: {
                    in: ingredientIds,
                },
            },
            select: { id: true, category: true },
        });
    },
};
