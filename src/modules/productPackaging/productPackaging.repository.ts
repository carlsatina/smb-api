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
            category: true,
            costPerUnit: true,
            active: true,
            deletedAt: true,
        },
    },
};

export const productPackagingRepository = {
    listByProduct: async (productId: string, client?: DbClient) => {
        return getClient(client).productPackaging.findMany({
            where: {
                productId,
            },
            include: lineInclude,
            orderBy: {
                ingredient: {
                    name: 'asc',
                },
            },
        });
    },
    deleteByProduct: async (productId: string, client?: DbClient) => {
        return getClient(client).productPackaging.deleteMany({
            where: {
                productId,
            },
        });
    },
    createLines: async (
        productId: string,
        lines: { ingredientId: string; qtyPerUnit: Prisma.Decimal }[],
        client?: DbClient
    ) => {
        if (lines.length === 0) {
            return { count: 0 };
        }
        return getClient(client).productPackaging.createMany({
            data: lines.map((line) => ({
                productId,
                ingredientId: line.ingredientId,
                qtyPerUnit: line.qtyPerUnit,
            })),
        });
    },
};
