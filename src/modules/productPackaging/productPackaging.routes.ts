import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { listPackagingLines, updatePackagingLines } from './productPackaging.controller';

export const productPackagingRouter = Router({ mergeParams: true });

const readRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.VIEWER];
const writeRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER];

productPackagingRouter.use(authMiddleware);
productPackagingRouter.use(requirePlanFeature('ingredients'));

productPackagingRouter.get('/', requireStoreRole(readRoles), listPackagingLines);
productPackagingRouter.put('/', requireStoreRole(writeRoles), updatePackagingLines);
