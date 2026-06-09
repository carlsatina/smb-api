import { Router } from 'express';
import { Role } from '@prisma/client';
import multer from 'multer';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import { exportSales, finalizeSale, getSale, importSales, listSales, voidSale } from './sale.controller';

export const saleRouter = Router({ mergeParams: true });

const readRoles = [Role.OWNER, Role.ADMIN, Role.CASHIER, Role.INVENTORY_MANAGER, Role.VIEWER];
const adminRoles = [Role.OWNER, Role.ADMIN];
const finalizeRoles = [Role.OWNER, Role.ADMIN, Role.CASHIER];
const voidRoles = [Role.OWNER, Role.ADMIN];

const csvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    },
});

saleRouter.use(authMiddleware);

saleRouter.get('/export', requireStoreRole(readRoles), requirePlanFeature('importExport'), exportSales);
saleRouter.post('/import', requireStoreRole(adminRoles), requirePlanFeature('importExport'), csvUpload.single('file'), importSales);
saleRouter.get('/', requireStoreRole(readRoles), listSales);
saleRouter.get('/:saleId', requireStoreRole(readRoles), getSale);
saleRouter.post('/finalize', requireStoreRole(finalizeRoles), finalizeSale);
saleRouter.post('/:saleId/void', requireStoreRole(voidRoles), voidSale);
