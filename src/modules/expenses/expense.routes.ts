import { Role } from '@prisma/client';
import { Router } from 'express';
import { csvUploadSingle } from '../../middlewares/csvUpload';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { authMiddleware } from '../../middlewares/auth';
import { requirePermission, requireStoreMember } from '../../middlewares/requirePermission';
import {
    createExpense,
    deleteExpense,
    exportExpenses,
    getExpense,
    importExpenses,
    listExpenses,
    updateExpense,
} from './expense.controller';

export const expenseRouter = Router({ mergeParams: true });

expenseRouter.use(authMiddleware);

// Export shows what the list shows. Bulk import stays with owners and admins
// (like the catalog CSVs), since cashiers can otherwise record expenses too.
expenseRouter.get('/export', requireStoreMember(), exportExpenses);
expenseRouter.post(
    '/import',
    requireStoreRole([Role.OWNER, Role.ADMIN]),
    requirePermission('expenses.manage'),
    csvUploadSingle,
    importExpenses
);
expenseRouter.get('/', requireStoreMember(), listExpenses);
expenseRouter.get('/:expenseId', requireStoreMember(), getExpense);
expenseRouter.post('/', requirePermission('expenses.manage'), createExpense);
expenseRouter.patch('/:expenseId', requirePermission('expenses.manage'), updateExpense);
expenseRouter.delete('/:expenseId', requirePermission('expenses.manage'), deleteExpense);
