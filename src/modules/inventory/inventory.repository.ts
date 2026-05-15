import { ItemType, MovementType, Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';

export type MovementFilters = {
    storeId: string;
    itemType?: ItemType;
    itemId?: string;
    type?: MovementType;
    createdById?: string;
    from?: Date;
    to?: Date;
};

const buildMovementWhere = (filters: MovementFilters): Prisma.InventoryMovementWhereInput => {
    const where: Prisma.InventoryMovementWhereInput = {
        storeId: filters.storeId,
    };

    if (filters.itemType) {
        where.itemType = filters.itemType;
    }
    if (filters.itemId) {
        where.itemId = filters.itemId;
    }
    if (filters.type) {
        where.type = filters.type;
    }
    if (filters.createdById) {
        where.createdById = filters.createdById;
    }
    if (filters.from || filters.to) {
        where.createdAt = {};
        if (filters.from) {
            where.createdAt.gte = filters.from;
        }
        if (filters.to) {
            where.createdAt.lte = filters.to;
        }
    }

    return where;
};

export const inventoryRepository = {
    sumByItemType: async (storeId: string, itemType: ItemType) => {
        return prisma.inventoryMovement.groupBy({
            by: ['itemId'],
            where: {
                storeId,
                itemType,
            },
            _sum: {
                qtyDelta: true,
            },
        });
    },
    sumByItemId: async (storeId: string, itemType: ItemType, itemId: string) => {
        const result = await prisma.inventoryMovement.aggregate({
            where: {
                storeId,
                itemType,
                itemId,
            },
            _sum: {
                qtyDelta: true,
            },
        });
        return result._sum.qtyDelta ?? new Prisma.Decimal(0);
    },
    listMovements: async (filters: MovementFilters, skip: number, take: number) => {
        const where = buildMovementWhere(filters);
        return prisma.inventoryMovement.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take,
            include: {
                createdBy: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                    },
                },
            },
        });
    },
    countMovements: async (filters: MovementFilters) => {
        const where = buildMovementWhere(filters);
        return prisma.inventoryMovement.count({ where });
    },
    createMovement: async (data: Prisma.InventoryMovementCreateInput) => {
        return prisma.inventoryMovement.create({
            data,
            include: {
                createdBy: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                    },
                },
            },
        });
    },
};
