import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';

type SupplierCreateData = Omit<Prisma.SupplierCreateInput, 'store'>;

export const supplierRepository = {
    listByStore: async (storeId: string) => {
        return prisma.supplier.findMany({
            where: {
                storeId,
                deletedAt: null,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
    },
    getById: async (storeId: string, supplierId: string) => {
        return prisma.supplier.findFirst({
            where: {
                id: supplierId,
                storeId,
                deletedAt: null,
            },
        });
    },
    create: async (storeId: string, data: SupplierCreateData) => {
        return prisma.supplier.create({
            data: {
                ...data,
                store: { connect: { id: storeId } },
            },
        });
    },
    update: async (
        storeId: string,
        supplierId: string,
        data: Parameters<typeof prisma.supplier.update>[0]['data']
    ) => {
        const updateResult = await prisma.supplier.updateMany({
            where: {
                id: supplierId,
                storeId,
                deletedAt: null,
            },
            data: data as Prisma.SupplierUpdateManyMutationInput,
        });

        if (updateResult.count === 0) {
            return null;
        }

        return prisma.supplier.findFirst({
            where: {
                id: supplierId,
                storeId,
                deletedAt: null,
            },
        });
    },
    softDelete: async (storeId: string, supplierId: string) => {
        const updateResult = await prisma.supplier.updateMany({
            where: {
                id: supplierId,
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

        return prisma.supplier.findFirst({
            where: {
                id: supplierId,
                storeId,
            },
        });
    },
};
