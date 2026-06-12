import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlatformAdmin } from '../../middlewares/requirePlatformAdmin';
import {
    getMetrics,
    getStats,
    grantUserFeature,
    grantUserPlan,
    getUserFeatures,
    listBilling,
    listBillingHistory,
    listStores,
    listUsers,
    overrideUserPlan,
    revokeUserFeature,
    revokeUserGrant,
    sendBillingNotice,
    toggleBillingMode,
    toggleSuperAdmin,
} from './admin.controller';

export const adminRouter = Router();

adminRouter.use(authMiddleware, requirePlatformAdmin);

adminRouter.get('/users', listUsers);
adminRouter.get('/stores', listStores);
adminRouter.get('/billing', listBilling);
adminRouter.get('/billing/history', listBillingHistory);
adminRouter.post('/billing/:storeId/send', sendBillingNotice);
adminRouter.patch('/users/:userId/plan', overrideUserPlan);
adminRouter.patch('/users/:userId/grant', grantUserPlan);
adminRouter.delete('/users/:userId/grant', revokeUserGrant);
adminRouter.patch('/users/:userId/super-admin', toggleSuperAdmin);
adminRouter.patch('/users/:userId/billing-mode', toggleBillingMode);
adminRouter.get('/stats', getStats);
adminRouter.get('/metrics', getMetrics);
adminRouter.get('/users/:userId/features', getUserFeatures);
adminRouter.post('/users/:userId/features', grantUserFeature);
adminRouter.delete('/users/:userId/features/:feature', revokeUserFeature);
