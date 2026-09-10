import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { getDailyReportQuerySchema, saveDailyReportSchema } from './dailyInventory.schemas';
import { dailyInventoryService } from './dailyInventory.service';

export const getDailyReport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);

    const { reportType, date } = getDailyReportQuerySchema.parse(req.query);
    const report = await dailyInventoryService.getDailyReport(storeId, reportType, date);
    res.status(200).json({ report });
});

export const saveDailyReport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const userId = req.user?.sub;
    const userRole = req.storeRole;

    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    if (!userId) throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
    if (!userRole) throw new AppError('FORBIDDEN', 'Store role required', 403);

    const body = saveDailyReportSchema.parse(req.body);
    const report = await dailyInventoryService.saveDailyReport(
        storeId,
        body.reportType,
        body.date,
        { items: body.items },
        userRole,
        userId
    );
    res.status(200).json({ report });
});
