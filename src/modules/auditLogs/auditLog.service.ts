import { Prisma } from '@prisma/client';
import { auditLogRepository, AuditLogFilters } from './auditLog.repository';

const mapAuditLog = (
    log: Prisma.AuditLogGetPayload<{
        include: { actor: { select: { id: true; fullName: true; email: true } } };
    }>
) => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    meta: log.meta,
    createdAt: log.createdAt,
    actor: log.actor,
});

export const auditLogService = {
    list: async (
        storeId: string,
        filters: Omit<AuditLogFilters, 'storeId'>,
        page: number,
        pageSize: number
    ) => {
        const skip = (page - 1) * pageSize;
        const fullFilters: AuditLogFilters = {
            storeId,
            ...filters,
        };

        const [total, logs] = await Promise.all([
            auditLogRepository.count(fullFilters),
            auditLogRepository.list(fullFilters, skip, pageSize),
        ]);

        return {
            logs: logs.map(mapAuditLog),
            total,
            page,
            pageSize,
        };
    },
};
