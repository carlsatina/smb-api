import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { getMetrics, overrideUserPlan } from './admin.controller';

export const adminRouter = Router();

adminRouter.use(authMiddleware);

adminRouter.patch('/users/:userId/plan', overrideUserPlan);
adminRouter.get('/metrics', getMetrics);
