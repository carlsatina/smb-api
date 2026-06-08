import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { requireUserFeature } from '../../middlewares/requireUserFeature';
import {
    createDailySalesEntry,
    deleteDailySalesEntry,
    getGoal,
    getPosForDate,
    listDailySales,
    setGoal,
    updateDailySalesEntry,
    upsertCashierEntry,
} from './dailySales.controller';

export const dailySalesRouter = Router({ mergeParams: true });

const ownerWithFeature = [
    authMiddleware,
    requireStoreRole([Role.OWNER, Role.CASHIER]),
    requireUserFeature('DAILY_SALES'),
];

const anyMember = [
    authMiddleware,
    requireStoreRole([Role.OWNER, Role.ADMIN, Role.CASHIER, Role.INVENTORY_MANAGER, Role.VIEWER]),
];

// POS for date (used by inline add row)
dailySalesRouter.get('/pos', ...ownerWithFeature, getPosForDate);

// Goal
dailySalesRouter.get('/goal', ...ownerWithFeature, getGoal);
dailySalesRouter.put('/goal', ...ownerWithFeature, setGoal);

// Entries (owner full access)
dailySalesRouter.get('/', ...ownerWithFeature, listDailySales);
dailySalesRouter.post('/', ...ownerWithFeature, createDailySalesEntry);
dailySalesRouter.patch('/:entryId', ...ownerWithFeature, updateDailySalesEntry);
dailySalesRouter.delete('/:entryId', ...ownerWithFeature, deleteDailySalesEntry);

// Cashier entry — owner saves for any userId, member saves only for themselves
dailySalesRouter.put('/:entryId/cashier-entry/:targetUserId', ...anyMember, upsertCashierEntry);
