import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { chat, generateDailySummary, reorderPlan } from './ai.controller';

export const aiRouter = Router({ mergeParams: true });

aiRouter.use(authMiddleware);

// These surface store financials (sales, margins), so restrict to owners/admins.
aiRouter.post('/daily-summary', requireStoreRole([Role.OWNER, Role.ADMIN]), generateDailySummary);
aiRouter.post('/chat', requireStoreRole([Role.OWNER, Role.ADMIN]), chat);

// Reorder is inventory-focused, so inventory managers can use it too.
aiRouter.post('/reorder', requireStoreRole([Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER]), reorderPlan);
