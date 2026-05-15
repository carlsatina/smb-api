import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';

type DbClient = Prisma.TransactionClient | typeof prisma;

const getClient = (client?: DbClient) => client ?? prisma;

const lineInclude = {
    ingredient: {
        select: {
            id: true,
            name: true,
            unit: true,
            costPerUnit: true,
            active: true,
            deletedAt: true,
        },
    },
};

export const recipeRepository = {
    getRecipeWithLines: async (storeId: string, productId: string, client?: DbClient) => {
        return getClient(client).recipe.findFirst({
            where: {
                storeId,
                productId,
                deletedAt: null,
            },
            include: {
                lines: {
                    include: lineInclude,
                    orderBy: {
                        ingredient: {
                            name: 'asc',
                        },
                    },
                },
            },
        });
    },
    upsertRecipe: async (storeId: string, productId: string, client?: DbClient) => {
        return getClient(client).recipe.upsert({
            where: {
                productId,
            },
            create: {
                storeId,
                productId,
            },
            update: {
                deletedAt: null,
            },
        });
    },
    deleteLines: async (recipeId: string, client?: DbClient) => {
        return getClient(client).recipeLine.deleteMany({
            where: {
                recipeId,
            },
        });
    },
    createLines: async (
        recipeId: string,
        lines: { ingredientId: string; qtyPerProductUnit: Prisma.Decimal }[],
        client?: DbClient
    ) => {
        if (lines.length === 0) {
            return { count: 0 };
        }
        return getClient(client).recipeLine.createMany({
            data: lines.map((line) => ({
                recipeId,
                ingredientId: line.ingredientId,
                qtyPerProductUnit: line.qtyPerProductUnit,
            })),
        });
    },
};
