import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { saleExportQuerySchema, saleFinalizeSchema, saleListQuerySchema } from './sale.schemas';
import { saleService } from './sale.service';

const parseCSV = (text: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];
        if (inQuotes) {
            if (char === '"' && next === '"') { field += '"'; i++; }
            else if (char === '"') { inQuotes = false; }
            else { field += char; }
        } else {
            if (char === '"') { inQuotes = true; }
            else if (char === ',') { row.push(field); field = ''; }
            else if (char === '\n') {
                row.push(field);
                if (row.some((f) => f.trim() !== '')) rows.push(row);
                row = []; field = '';
            } else if (char === '\r') {
                // skip
            } else { field += char; }
        }
    }
    if (field || row.length > 0) {
        row.push(field);
        if (row.some((f) => f.trim() !== '')) rows.push(row);
    }
    return rows;
};

export const listSales = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const query = saleListQuerySchema.parse(req.query);
    const data = await saleService.list(
        storeId,
        {
            status: query.status,
            from: query.from,
            to: query.to,
            cashierId: query.cashierId,
            paymentMethod: query.paymentMethod,
            productId: query.productId,
        },
        query.page,
        query.pageSize
    );
    res.status(200).json(data);
});

export const getSale = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const saleId = req.params.saleId;
    if (!storeId || !saleId) {
        throw new AppError('BAD_REQUEST', 'Store and sale are required', 400);
    }

    const sale = await saleService.get(storeId, saleId);
    res.status(200).json({ sale });
});

export const finalizeSale = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const userId = req.user?.sub;
    if (!storeId || !userId) {
        throw new AppError('UNAUTHORIZED', 'Missing store or user context', 401);
    }

    const payload = saleFinalizeSchema.parse(req.body);
    const sale = await saleService.finalize(storeId, userId, payload);
    res.status(201).json({ sale });
});

const escapeCsvValue = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
};

export const exportSales = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);

    const query = saleExportQuerySchema.parse(req.query);
    const filters = {
        status: query.status,
        from: query.from,
        to: query.to,
        cashierId: query.cashierId,
        paymentMethod: query.paymentMethod,
        productId: query.productId,
    };

    const pageSize = 100;
    let page = 1;
    let total = 0;
    const rows: Array<Array<string | number | null | undefined>> = [
        ['Receipt #', 'Date', 'Status', 'Cashier', 'Payment Method', 'Items', 'Subtotal', 'Discount', 'Tax', 'Total'],
    ];

    do {
        const data = await saleService.list(storeId, filters, page, pageSize);
        total = data.total;
        data.sales.forEach((sale) => {
            rows.push([
                sale.receiptNumber ?? '',
                sale.createdAt instanceof Date ? sale.createdAt.toISOString() : sale.createdAt,
                sale.status,
                sale.cashier?.fullName || sale.cashier?.email || '',
                sale.paymentMethod,
                sale.items.map((i) => `${i.name} x${i.qty}`).join('; '),
                sale.subtotal,
                sale.discount,
                sale.tax,
                sale.total,
            ]);
        });
        page++;
    } while (rows.length - 1 < total);

    const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
    const filename = `sales-${storeId}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
});

export const importSales = asyncHandler(async (req: AuthRequest & { file?: Express.Multer.File }, res: Response) => {
    const storeId = req.params.storeId;
    const importerId = req.user?.sub;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    if (!importerId) throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
    if (!req.file) throw new AppError('FILE_REQUIRED', 'CSV file is required', 400);

    const text = req.file.buffer.toString('utf-8');
    const rows = parseCSV(text);
    if (rows.length < 2) throw new AppError('EMPTY_FILE', 'CSV file has no data rows', 400);

    const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[_\s]/g, ''));
    const col = (name: string) => headers.indexOf(name);

    const REQUIRED = ['saleid', 'date', 'productname', 'quantity', 'unitprice'];
    const missing = REQUIRED.filter((h) => col(h) === -1);
    if (missing.length > 0) {
        throw new AppError('INVALID_HEADERS', `CSV missing required columns: ${missing.join(', ')}`, 400);
    }

    const rawRows = rows.slice(1).map((r) => ({
        saleId: r[col('saleid')]?.trim() ?? '',
        date: r[col('date')]?.trim() ?? '',
        paymentMode: col('paymentmode') !== -1 ? (r[col('paymentmode')]?.trim() ?? '') : '',
        productName: r[col('productname')]?.trim() ?? '',
        qty: Number(r[col('quantity')]?.trim()),
        unitPrice: Number(r[col('unitprice')]?.trim()),
        lineTotal: col('linetotal') !== -1 ? Number(r[col('linetotal')]?.trim()) : Number(r[col('unitprice')]?.trim()) * Number(r[col('quantity')]?.trim()),
    })).filter((r) => r.saleId);

    const result = await saleService.importSales(storeId, importerId, rawRows);
    res.status(200).json(result);
});

export const voidSale = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const saleId = req.params.saleId;
    const userId = req.user?.sub;

    if (!storeId || !saleId || !userId) {
        throw new AppError('BAD_REQUEST', 'Store, sale, and user are required', 400);
    }

    const sale = await saleService.voidSale(storeId, userId, saleId);
    res.status(200).json({ sale });
});
