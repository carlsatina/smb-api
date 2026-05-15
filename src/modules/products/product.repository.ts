import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';

const recipeCountInclude = {
    recipe: {
        select: {
            deletedAt: true,
            _count: {
                select: {
                    lines: true,
                },
            },
        },
    },
} satisfies Prisma.ProductInclude;

type ProductWithRecipeCount = Prisma.ProductGetPayload<{ include: typeof recipeCountInclude }>;
type ProductCreateData = Omit<Prisma.ProductCreateInput, 'store'>;

export const productRepository = {
    listByStore: async (storeId: string): Promise<ProductWithRecipeCount[]> => {
        return prisma.product.findMany({
            where: {
                storeId,
                deletedAt: null,
            },
            orderBy: {
                createdAt: 'desc',
            },
            include: recipeCountInclude,
        });
    },
    getById: async (storeId: string, productId: string): Promise<ProductWithRecipeCount | null> => {
        return prisma.product.findFirst({
            where: {
                id: productId,
                storeId,
                deletedAt: null,
            },
            include: recipeCountInclude,
        });
    },
    create: async (storeId: string, data: ProductCreateData): Promise<ProductWithRecipeCount> => {
        return prisma.product.create({
            data: {
                ...data,
                store: { connect: { id: storeId } },
            },
            include: recipeCountInclude,
        });
    },
    update: async (
        storeId: string,
        productId: string,
        data: Parameters<typeof prisma.product.update>[0]['data']
    ): Promise<ProductWithRecipeCount | null> => {
        const updateResult = await prisma.product.updateMany({
            where: {
                id: productId,
                storeId,
                deletedAt: null,
            },
            data: data as Prisma.ProductUpdateManyMutationInput,
        });

        if (updateResult.count === 0) {
            return null;
        }

        return prisma.product.findFirst({
            where: {
                id: productId,
                storeId,
                deletedAt: null,
            },
            include: recipeCountInclude,
        });
    },
    softDelete: async (storeId: string, productId: string) => {
        const updateResult = await prisma.product.updateMany({
            where: {
                id: productId,
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

        return prisma.product.findFirst({
            where: {
                id: productId,
                storeId,
            },
        });
    },
    countRecipeLinesByProductId: async (storeId: string, productId: string) => {
        return prisma.recipeLine.count({
            where: {
                recipe: {
                    productId,
                    storeId,
                    deletedAt: null,
                },
            },
        });
    },
};
