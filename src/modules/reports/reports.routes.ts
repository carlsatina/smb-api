import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePermission } from '../../middlewares/requirePermission';
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


reportsRouter.use(authMiddleware);

reportsRouter.get('/sales-summary', requirePermission('reports.view'), getSalesSummary);
reportsRouter.get('/sales-by-day', requirePermission('reports.view'), getSalesByDay);
reportsRouter.get('/sales-by-hour', requirePermission('reports.view'), getSalesByHour);
reportsRouter.get('/top-products', requirePermission('reports.view'), getTopProducts);
reportsRouter.get('/products-sold', requirePermission('reports.view'), getProductsSold);
reportsRouter.get('/low-stock', requirePermission('reports.view'), getLowStock);
reportsRouter.get('/ingredient-usage', requirePermission('reports.view'), requirePlanFeature('ingredients'), getIngredientUsage);
reportsRouter.get('/purchase-spend', requirePermission('reports.view'), requirePlanFeature('purchaseOrders'), getPurchaseSpend);
reportsRouter.get('/product-margins', requirePermission('reports.view'), getProductMargins);
reportsRouter.get('/profit-summary', requirePermission('reports.view'), getProfitSummary);
reportsRouter.get('/expense-summary', requirePermission('reports.view'), requirePlanFeature('expenses'), getExpenseSummary);
reportsRouter.get('/payment-methods', requirePermission('reports.view'), getPaymentMethodBreakdown);
reportsRouter.get('/employee-sales', requirePermission('reports.view'), getEmployeeSales);
