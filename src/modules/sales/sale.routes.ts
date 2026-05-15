import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { finalizeSale, getSale, listSales, voidSale } from './sale.controller';

export const saleRouter = Router({ mergeParams: true });

const readRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.VIEWER];
const finalizeRoles = [Role.OWNER, Role.ADMIN, Role.CASHIER];
const voidRoles = [Role.OWNER, Role.ADMIN];

saleRouter.use(authMiddleware);

saleRouter.get('/', requireStoreRole(readRoles), listSales);
saleRouter.get('/:saleId', requireStoreRole(readRoles), getSale);
saleRouter.post('/finalize', requireStoreRole(finalizeRoles), finalizeSale);
saleRouter.post('/:saleId/void', requireStoreRole(voidRoles), voidSale);
