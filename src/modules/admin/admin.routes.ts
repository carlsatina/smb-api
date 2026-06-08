import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlatformAdmin } from '../../middlewares/requirePlatformAdmin';
import {
    getMetrics,
    getStats,
    grantUserFeature,
    grantUserPlan,
    getUserFeatures,
    listStores,
    listUsers,
    overrideUserPlan,
    revokeUserFeature,
    revokeUserGrant,
    toggleSuperAdmin,
} from './admin.controller';

export const adminRouter = Router();

adminRouter.use(authMiddleware, requirePlatformAdmin);

adminRouter.get('/users', listUsers);
adminRouter.get('/stores', listStores);
adminRouter.patch('/users/:userId/plan', overrideUserPlan);
adminRouter.patch('/users/:userId/grant', grantUserPlan);
adminRouter.delete('/users/:userId/grant', revokeUserGrant);
adminRouter.patch('/users/:userId/super-admin', toggleSuperAdmin);
adminRouter.get('/stats', getStats);
adminRouter.get('/metrics', getMetrics);
adminRouter.get('/users/:userId/features', getUserFeatures);
adminRouter.post('/users/:userId/features', grantUserFeature);
adminRouter.delete('/users/:userId/features/:feature', revokeUserFeature);
