import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../middlewares/auth';
import { requirePlanFeature } from '../../middlewares/requirePlanFeature';
import { requirePermission, requireStoreMember } from '../../middlewares/requirePermission';
import { exportSales, finalizeSale, getSale, importSales, listSales, updateSale, voidSale } from './sale.controller';

export const saleRouter = Router({ mergeParams: true });


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

saleRouter.get('/export', requireStoreMember(), requirePlanFeature('importExport'), exportSales);
saleRouter.post('/import', requirePermission('sales.edit'), requirePlanFeature('importExport'), csvUpload.single('file'), importSales);
saleRouter.get('/', requireStoreMember(), listSales);
saleRouter.get('/:saleId', requireStoreMember(), getSale);
saleRouter.post('/finalize', requirePermission('pos.use'), finalizeSale);
saleRouter.patch('/:saleId', requirePermission('sales.edit'), updateSale);
saleRouter.post('/:saleId/void', requirePermission('sales.void'), voidSale);
