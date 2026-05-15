import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import prisma from '../../../lib/prisma';

export type PurchaseOrderFilters = {
    storeId: string;
    status?: PurchaseOrderStatus;
    search?: string;
    from?: Date;
    to?: Date;
    supplierId?: string | null;
    supplierName?: string;
};

const buildWhere = (filters: PurchaseOrderFilters): Prisma.PurchaseOrderWhereInput => {
    const where: Prisma.PurchaseOrderWhereInput = {
        storeId: filters.storeId,
        deletedAt: null,
    };
    const andFilters: Prisma.PurchaseOrderWhereInput[] = [];

    if (filters.status) {
        where.status = filters.status;
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

    if (filters.supplierId !== undefined) {
        if (filters.supplierId === null) {
            where.supplierId = null;
        } else {
            where.supplierId = filters.supplierId;
        }
    }

    if (filters.supplierName) {
        andFilters.push({
            OR: [
                { supplier: { name: { contains: filters.supplierName, mode: 'insensitive' } } },
                { supplierName: { contains: filters.supplierName, mode: 'insensitive' } },
            ],
        });
    }

    const search = filters.search?.trim();
    if (search) {
        const normalized = search.toUpperCase().replace(/\s+/g, '_');
        const statusMatches = Object.values(PurchaseOrderStatus).filter((status) =>
            status.includes(normalized)
        );
        const searchFilters: Prisma.PurchaseOrderWhereInput[] = [
            { id: { contains: search, mode: 'insensitive' } },
            { supplier: { name: { contains: search, mode: 'insensitive' } } },
            { supplierName: { contains: search, mode: 'insensitive' } },
        ];
        if (statusMatches.length) {
            searchFilters.push({ status: { in: statusMatches } });
        }
        andFilters.push({ OR: searchFilters });
    }

    if (andFilters.length) {
        where.AND = andFilters;
    }

    return where;
};

export const purchaseOrderRepository = {
    list: async (filters: PurchaseOrderFilters, skip: number, take: number) => {
        const where = buildWhere(filters);
        return prisma.purchaseOrder.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take,
            include: {
                supplier: {
                    select: { id: true, name: true },
                },
                items: {
                    select: {
                        qtyOrdered: true,
                        qtyReceived: true,
                    },
                },
                receipts: {
                    select: {
                        invoiceNumber: true,
                    },
                    orderBy: { receivedAt: 'desc' },
                    take: 1,
                },
            },
        });
    },
    count: async (filters: PurchaseOrderFilters) => {
        const where = buildWhere(filters);
        return prisma.purchaseOrder.count({ where });
    },
    countByStatus: async (filters: PurchaseOrderFilters) => {
        const where = buildWhere(filters);
        return prisma.purchaseOrder.groupBy({
            by: ['status'],
            where,
            _count: { _all: true },
        });
    },
    getById: async (storeId: string, purchaseOrderId: string) => {
        return prisma.purchaseOrder.findFirst({
            where: {
                id: purchaseOrderId,
                storeId,
                deletedAt: null,
            },
            include: {
                supplier: {
                    select: { id: true, name: true },
                },
                items: {
                    include: {
                        product: {
                            select: { id: true, name: true, sku: true, unit: true, type: true },
                        },
                        ingredient: {
                            select: { id: true, name: true, unit: true },
                        },
                    },
                },
                receipts: {
                    select: {
                        id: true,
                        invoiceNumber: true,
                        receivedAt: true,
                        totalCost: true,
                    },
                    orderBy: { receivedAt: 'desc' },
                },
            },
        });
    },
};
