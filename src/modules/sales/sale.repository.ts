import { PaymentMethod, Prisma, SaleStatus } from '@prisma/client';
import prisma from '../../../lib/prisma';

export type SaleFilters = {
    storeId: string;
    status?: SaleStatus;
    from?: Date;
    to?: Date;
    cashierId?: string;
    paymentMethod?: PaymentMethod;
    productId?: string;
};

const buildWhere = (filters: SaleFilters): Prisma.SaleWhereInput => {
    const where: Prisma.SaleWhereInput = {
        storeId: filters.storeId,
        deletedAt: null,
    };

    if (filters.status) {
        where.status = filters.status;
    }

    if (filters.cashierId) {
        where.cashierId = filters.cashierId;
    }

    if (filters.paymentMethod) {
        where.paymentMethod = filters.paymentMethod;
    }

    if (filters.productId) {
        where.items = {
            some: {
                productId: filters.productId,
            },
        };
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

export const saleRepository = {
    listSales: async (filters: SaleFilters, skip: number, take: number) => {
        const where = buildWhere(filters);
        return prisma.sale.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take,
            include: {
                cashier: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                    },
                },
                items: {
                    select: {
                        id: true,
                        nameSnapshot: true,
                        qty: true,
                    },
                },
                _count: {
                    select: { items: true },
                },
            },
        });
    },
    countSales: async (filters: SaleFilters) => {
        const where = buildWhere(filters);
        return prisma.sale.count({ where });
    },
    getById: async (storeId: string, saleId: string) => {
        return prisma.sale.findFirst({
            where: {
                id: saleId,
                storeId,
                deletedAt: null,
            },
            include: {
                cashier: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                    },
                },
                items: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                sku: true,
                                unit: true,
                                type: true,
                            },
                        },
                    },
                },
            },
        });
    },
};
