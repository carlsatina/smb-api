import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlatformAdmin } from '../../middlewares/requirePlatformAdmin';
import {
    getMetrics,
    getStats,
    grantUserFeature,
    getUserFeatures,
    listBilling,
    listBillingHistory,
    listStores,
    listUsers,
    revokeUserFeature,
    sendBillingNotice,
    setBillingPayment,
    setOwnerDiscount,
    setOwnerSuspension,
    setStoreExemption,
    toggleSuperAdmin,
} from './admin.controller';

export const adminRouter = Router();

adminRouter.use(authMiddleware, requirePlatformAdmin);

adminRouter.get('/users', listUsers);
adminRouter.get('/stores', listStores);
adminRouter.get('/billing', listBilling);
adminRouter.get('/billing/history', listBillingHistory);
adminRouter.post('/billing/:ownerId/send', sendBillingNotice);
adminRouter.patch('/billing/:ownerId/payment', setBillingPayment);
adminRouter.patch('/billing/owners/:ownerId/discount', setOwnerDiscount);
adminRouter.patch('/billing/owners/:ownerId/suspension', setOwnerSuspension);
adminRouter.patch('/billing/stores/:storeId/exemption', setStoreExemption);
adminRouter.patch('/users/:userId/super-admin', toggleSuperAdmin);
adminRouter.get('/stats', getStats);
adminRouter.get('/metrics', getMetrics);
adminRouter.get('/users/:userId/features', getUserFeatures);
adminRouter.post('/users/:userId/features', grantUserFeature);
adminRouter.delete('/users/:userId/features/:feature', revokeUserFeature);
