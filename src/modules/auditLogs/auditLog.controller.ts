import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { auditLogExportQuerySchema, auditLogQuerySchema } from './auditLog.schemas';
import { auditLogService } from './auditLog.service';

export const listAuditLogs = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = auditLogQuerySchema.parse(req.query);
    const result = await auditLogService.list(
        storeId,
        {
            action: query.action,
            actorId: query.actorId,
            entityType: query.entityType,
            from: query.from,
            to: query.to,
        },
        query.page,
        query.pageSize
    );

    res.status(200).json(result);
});

const escapeCsvValue = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
};

export const exportAuditLogs = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = auditLogExportQuerySchema.parse(req.query);
    const pageSize = 100;
    let page = 1;
    let total = 0;
    const rows: Array<Array<string | number | null | undefined>> = [
        ['Created At', 'Action', 'Entity Type', 'Entity ID', 'Actor', 'Actor Email', 'Meta JSON'],
    ];

    do {
        const data = await auditLogService.list(
            storeId,
            {
                action: query.action,
                actorId: query.actorId,
                entityType: query.entityType,
                from: query.from,
                to: query.to,
            },
            page,
            pageSize
        );
        total = data.total;
        data.logs.forEach((log) => {
            rows.push([
                log.createdAt.toISOString(),
                log.action,
                log.entityType,
                log.entityId ?? '',
                log.actor?.fullName || log.actor?.email || 'System',
                log.actor?.email || '',
                log.meta ? JSON.stringify(log.meta) : '',
            ]);
        });
        page += 1;
    } while (rows.length - 1 < total);

    const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
    const filename = `audit-log-${storeId}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
});
