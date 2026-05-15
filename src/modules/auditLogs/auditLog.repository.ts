import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';

export type AuditLogFilters = {
    storeId: string;
    action?: string;
    actorId?: string;
    entityType?: string;
    q?: string;
    from?: Date;
    to?: Date;
};

const buildWhere = (filters: AuditLogFilters): Prisma.AuditLogWhereInput => {
    const where: Prisma.AuditLogWhereInput = {
        storeId: filters.storeId,
    };

    if (filters.action) {
        where.action = filters.action;
    }

    if (filters.actorId) {
        where.actorId = filters.actorId;
    }

    if (filters.entityType) {
        where.entityType = filters.entityType;
    }

    if (filters.q) {
        const searchTerm = filters.q.trim();
        where.OR = [
            { actor: { fullName: { contains: searchTerm, mode: 'insensitive' } } },
            { actor: { email: { contains: searchTerm, mode: 'insensitive' } } },
            { entityType: { contains: searchTerm, mode: 'insensitive' } },
            { action: { contains: searchTerm, mode: 'insensitive' } },
        ];
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

export const auditLogRepository = {
    list: async (filters: AuditLogFilters, skip: number, take: number) => {
        const where = buildWhere(filters);
        return prisma.auditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take,
            include: {
                actor: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                    },
                },
            },
        });
    },
    count: async (filters: AuditLogFilters) => {
        const where = buildWhere(filters);
        return prisma.auditLog.count({ where });
    },
};
