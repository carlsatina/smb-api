import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePermission } from '../../middlewares/requirePermission';
import { exportAuditLogs, listAuditLogs } from './auditLog.controller';

export const auditLogRouter = Router({ mergeParams: true });

auditLogRouter.use(authMiddleware);

auditLogRouter.get(
    '/export',
    requirePermission('store.manage'),
    exportAuditLogs
);
auditLogRouter.get('/', requirePermission('store.manage'), listAuditLogs);
