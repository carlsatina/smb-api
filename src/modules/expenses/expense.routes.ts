import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePermission, requireStoreMember } from '../../middlewares/requirePermission';
import { createExpense, deleteExpense, getExpense, listExpenses, updateExpense } from './expense.controller';

export const expenseRouter = Router({ mergeParams: true });


expenseRouter.use(authMiddleware);

expenseRouter.get('/', requireStoreMember(), listExpenses);
expenseRouter.get('/:expenseId', requireStoreMember(), getExpense);
expenseRouter.post('/', requirePermission('expenses.manage'), createExpense);
expenseRouter.patch('/:expenseId', requirePermission('expenses.manage'), updateExpense);
expenseRouter.delete('/:expenseId', requirePermission('expenses.manage'), deleteExpense);
