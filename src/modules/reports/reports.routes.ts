import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import {
    getEmployeeSales,
    getExpenseSummary,
    getIngredientUsage,
    getLowStock,
    getPaymentMethodBreakdown,
    getProductMargins,
    getProductsSold,
    getProfitSummary,
    getPurchaseSpend,
    getSalesByDay,
    getSalesByHour,
    getSalesSummary,
    getTopProducts,
} from './reports.controller';

export const reportsRouter = Router({ mergeParams: true });

const readRoles = [Role.OWNER, Role.ADMIN, Role.INVENTORY_MANAGER, Role.VIEWER];

reportsRouter.use(authMiddleware);

reportsRouter.get('/sales-summary', requireStoreRole(readRoles), getSalesSummary);
reportsRouter.get('/sales-by-day', requireStoreRole(readRoles), getSalesByDay);
reportsRouter.get('/sales-by-hour', requireStoreRole(readRoles), getSalesByHour);
reportsRouter.get('/top-products', requireStoreRole(readRoles), getTopProducts);
reportsRouter.get('/products-sold', requireStoreRole(readRoles), getProductsSold);
reportsRouter.get('/low-stock', requireStoreRole(readRoles), getLowStock);
reportsRouter.get('/ingredient-usage', requireStoreRole(readRoles), requirePlanFeature('ingredients'), getIngredientUsage);
reportsRouter.get('/purchase-spend', requireStoreRole(readRoles), requirePlanFeature('purchaseOrders'), getPurchaseSpend);
reportsRouter.get('/product-margins', requireStoreRole(readRoles), getProductMargins);
reportsRouter.get('/profit-summary', requireStoreRole(readRoles), getProfitSummary);
reportsRouter.get('/expense-summary', requireStoreRole(readRoles), requirePlanFeature('expenses'), getExpenseSummary);
reportsRouter.get('/payment-methods', requireStoreRole(readRoles), getPaymentMethodBreakdown);
reportsRouter.get('/employee-sales', requireStoreRole(readRoles), getEmployeeSales);
