import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import {
    createDailySalesEntrySchema,
    listDailySalesQuerySchema,
    posForDateSchema,
    setGoalSchema,
    updateDailySalesEntrySchema,
    upsertCashierEntrySchema,
} from './dailySales.schemas';
import { dailySalesService } from './dailySales.service';

export const listDailySales = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);

    const { year, month } = listDailySalesQuerySchema.parse(req.query);
    const data = await dailySalesService.listMonth(storeId, year, month);
    res.status(200).json(data);
});

export const createDailySalesEntry = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const userId = req.user?.sub;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    if (!userId) throw new AppError('UNAUTHORIZED', 'Authentication required', 401);

    const body = createDailySalesEntrySchema.parse(req.body);
    const entry = await dailySalesService.createEntry(storeId, userId, body);
    res.status(201).json({ entry });
});

export const updateDailySalesEntry = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, entryId } = req.params;
    if (!storeId || !entryId) throw new AppError('BAD_REQUEST', 'Store and entry are required', 400);

    const body = updateDailySalesEntrySchema.parse(req.body);
    const entry = await dailySalesService.updateEntry(storeId, entryId, body);
    res.status(200).json({ entry });
});

export const deleteDailySalesEntry = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, entryId } = req.params;
    if (!storeId || !entryId) throw new AppError('BAD_REQUEST', 'Store and entry are required', 400);

    await dailySalesService.deleteEntry(storeId, entryId);
    res.status(204).send();
});

export const upsertCashierEntry = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { storeId, entryId, targetUserId } = req.params;
    const requesterId = req.user?.sub;
    if (!storeId || !entryId || !targetUserId) throw new AppError('BAD_REQUEST', 'Store, entry, and target user are required', 400);
    if (!requesterId) throw new AppError('UNAUTHORIZED', 'Authentication required', 401);

    const body = upsertCashierEntrySchema.parse(req.body);
    const cashierEntry = await dailySalesService.upsertCashierEntry(storeId, entryId, targetUserId, body);
    res.status(200).json({ cashierEntry });
});

export const getPosForDate = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    const { date } = posForDateSchema.parse(req.query);
    const { pos, seniorDiscount } = await dailySalesService.getPosForDate(storeId, date);
    res.status(200).json({ pos, seniorDiscount });
});

export const getGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);

    const goal = await dailySalesService.getGoal(storeId);
    res.status(200).json({ goal });
});

export const setGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const userId = req.user?.sub;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    if (!userId) throw new AppError('UNAUTHORIZED', 'Authentication required', 401);

    const { goal, effectiveDate } = setGoalSchema.parse(req.body);
    const result = await dailySalesService.setGoal(storeId, userId, goal, effectiveDate);
    res.status(200).json({ goal: result });
});
