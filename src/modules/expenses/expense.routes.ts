import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { createExpense, deleteExpense, getExpense, listExpenses, updateExpense } from './expense.controller';

export const expenseRouter = Router({ mergeParams: true });

const readRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.VIEWER, Role.CASHIER];
const writeRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.CASHIER];

expenseRouter.use(authMiddleware);
expenseRouter.use(requirePlanFeature('expenses'));

expenseRouter.get('/', requireStoreRole(readRoles), listExpenses);
expenseRouter.get('/:expenseId', requireStoreRole(readRoles), getExpense);
expenseRouter.post('/', requireStoreRole(writeRoles), createExpense);
expenseRouter.patch('/:expenseId', requireStoreRole(writeRoles), updateExpense);
expenseRouter.delete('/:expenseId', requireStoreRole(writeRoles), deleteExpense);
