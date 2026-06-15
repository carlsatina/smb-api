import { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { AuthRequest } from '../../middlewares/auth';
import { expenseCreateSchema, expenseUpdateSchema, listExpensesQuerySchema } from './expense.schemas';
import { expenseService } from './expense.service';

export const listExpenses = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = listExpensesQuerySchema.parse(req.query);
    const expenses = await expenseService.list(storeId, req.storeRole, query);
    res.status(200).json({ expenses });
});

export const getExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const expenseId = req.params.expenseId;
    if (!storeId || !expenseId) {
        throw new AppError('BAD_REQUEST', 'Store and expense are required', 400);
    }

    const expense = await expenseService.get(storeId, req.storeRole, expenseId);
    res.status(200).json({ expense });
});

export const createExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const userId = req.user?.sub;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }
    if (!userId) {
        throw new AppError('UNAUTHORIZED', 'User is required to record expenses.', 401);
    }

    const payload = expenseCreateSchema.parse(req.body);
    const expense = await expenseService.create(storeId, userId, payload);
    res.status(201).json({ expense });
});

export const updateExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const expenseId = req.params.expenseId;
    if (!storeId || !expenseId) {
        throw new AppError('BAD_REQUEST', 'Store and expense are required', 400);
    }

    const payload = expenseUpdateSchema.parse(req.body);
    const expense = await expenseService.update(storeId, expenseId, payload, req.user?.sub);
    res.status(200).json({ expense });
});

export const deleteExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const expenseId = req.params.expenseId;
    if (!storeId || !expenseId) {
        throw new AppError('BAD_REQUEST', 'Store and expense are required', 400);
    }

    await expenseService.remove(storeId, expenseId, req.user?.sub);
    res.status(204).send();
});
