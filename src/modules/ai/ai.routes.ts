import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePermission } from '../../middlewares/requirePermission';
import { chat, generateDailySummary, reorderPlan } from './ai.controller';

export const aiRouter = Router({ mergeParams: true });

aiRouter.use(authMiddleware);

// These surface store financials (sales, margins), so restrict to owners/admins.
aiRouter.post('/daily-summary', requirePermission('ai.use'), generateDailySummary);
aiRouter.post('/chat', requirePermission('ai.use'), chat);

// Reorder is inventory-focused, so inventory managers can use it too.
aiRouter.post('/reorder', requirePermission('inventory.manage'), reorderPlan);
