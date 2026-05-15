import cors from 'cors';
import express from 'express';
import { env } from './config/env';
import prisma from '../lib/prisma';
import { requestId } from './middlewares/requestId';
import { requestLogger } from './middlewares/requestLogger';
import { securityHeaders } from './middlewares/securityHeaders';
import { captureHealthCheck } from './shared/errorReporting';
import { auditLogRouter } from './modules/auditLogs/auditLog.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { authRouter } from './modules/auth/auth.routes';
import { ingredientRouter } from './modules/ingredients/ingredient.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { productRouter } from './modules/products/product.routes';
import { purchaseOrderRouter } from './modules/purchaseOrders/purchaseOrder.routes';
import { recipeRouter } from './modules/recipes/recipe.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { saleRouter } from './modules/sales/sale.routes';
import { storeInviteRouter, storeMemberRouter } from './modules/storeMembers/storeMember.routes';
import { storeRouter } from './modules/stores/store.routes';
import { supplierRouter } from './modules/suppliers/supplier.routes';
import { errorHandler } from './middlewares/errorHandler';

export const createApp = () => {
    const app = express();

    app.use(securityHeaders);
    app.use(
        cors({
            origin: (origin, callback) => {
                if (!origin) {
                    return callback(null, true);
                }
                if (!env.corsOrigins.length) {
                    return callback(null, true);
                }
                return callback(null, env.corsOrigins.includes(origin));
            },
            credentials: true,
        })
    );
    app.use(requestId);
    app.use(requestLogger);
    app.use(express.json({ limit: '1mb' }));

    app.get('/health', async (req, res) => {
        const start = Date.now();
        let dbHealthy = true;
        try {
            await prisma.$queryRaw`SELECT 1`;
        } catch (error) {
            dbHealthy = false;
        }
        captureHealthCheck(dbHealthy ? 'ok' : 'error', Date.now() - start);
        res.status(dbHealthy ? 200 : 503).json({
            status: dbHealthy ? 'ok' : 'degraded',
            db: dbHealthy ? 'ok' : 'error',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        });
    });

    app.use('/api/v1/auth', authRouter);
    app.use('/api/v1/admin', adminRouter);
    app.use('/api/v1/stores', storeRouter);
    app.use('/api/v1/stores/:storeId/products', productRouter);
    app.use('/api/v1/stores/:storeId/ingredients', ingredientRouter);
    app.use('/api/v1/stores/:storeId/products/:productId/recipe-lines', recipeRouter);
    app.use('/api/v1/stores/:storeId/inventory', inventoryRouter);
    app.use('/api/v1/stores/:storeId/sales', saleRouter);
    app.use('/api/v1/stores/:storeId/reports', reportsRouter);
    app.use('/api/v1/stores/:storeId/purchase-orders', purchaseOrderRouter);
    app.use('/api/v1/stores/:storeId/suppliers', supplierRouter);
    app.use('/api/v1/stores/:storeId/audit-logs', auditLogRouter);
    app.use('/api/v1/stores/:storeId/members', storeMemberRouter);
    app.use('/api/v1/stores/:storeId/invites', storeInviteRouter);

    app.use(errorHandler);

    return app;
};
