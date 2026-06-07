import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { exportAuditLogs, listAuditLogs } from './auditLog.controller';

export const auditLogRouter = Router({ mergeParams: true });

auditLogRouter.use(authMiddleware);

auditLogRouter.get(
    '/export',
    requireStoreRole([Role.OWNER, Role.ADMIN]),
    requirePlanFeature('importExport'),
    exportAuditLogs
);
auditLogRouter.get('/', requireStoreRole([Role.OWNER, Role.ADMIN]), listAuditLogs);
