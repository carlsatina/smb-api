import { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { AuthRequest } from '../../middlewares/auth';
import { productCreateSchema, productUpdateSchema } from './product.schemas';
import { productService } from './product.service';

const escapeCsvValue = (value: string | number | boolean | null | undefined): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
};

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
                // skip \r
            } else { field += char; }
        }
    }
    if (field || row.length > 0) {
        row.push(field);
        if (row.some((f) => f.trim() !== '')) rows.push(row);
    }
    return rows;
};

export const listProducts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const products = await productService.list(storeId);
    res.status(200).json({ products });
});

export const getProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const productId = req.params.productId;
    if (!storeId || !productId) {
        throw new AppError('BAD_REQUEST', 'Store and product are required', 400);
    }

    const product = await productService.get(storeId, productId);
    res.status(200).json({ product });
});

export const createProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const payload = productCreateSchema.parse(req.body);
    const { recipeLines, ...productData } = payload;
    const product = await productService.create(storeId, productData, recipeLines);
    res.status(201).json({ product });
});

export const updateProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const productId = req.params.productId;
    if (!storeId || !productId) {
        throw new AppError('BAD_REQUEST', 'Store and product are required', 400);
    }

    const payload = productUpdateSchema.parse(req.body);
    const { recipeLines, ...productData } = payload;
    const product = await productService.update(storeId, productId, productData, recipeLines);
    res.status(200).json({ product });
});

export const deleteProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const productId = req.params.productId;
    if (!storeId || !productId) {
        throw new AppError('BAD_REQUEST', 'Store and product are required', 400);
    }

    await productService.remove(storeId, productId);
    res.status(204).send();
});

export const exportProducts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);

    const products = await productService.list(storeId);

    const rows: Array<Array<string | number | boolean | null | undefined>> = [
        ['Name', 'Type', 'SKU', 'Barcode', 'Price', 'Cost', 'Unit', 'Category', 'Active', 'Low Stock Threshold'],
        ...products.map((p) => [p.name, p.type, p.sku, p.barcode, Number(p.price), p.cost != null ? Number(p.cost) : null, p.unit, p.category, p.active, p.lowStockThreshold != null ? Number(p.lowStockThreshold) : null]),
    ];

    const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
    const filename = `products-${storeId}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
});

export const importProducts = asyncHandler(async (req: AuthRequest & { file?: Express.Multer.File }, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    if (!req.file) throw new AppError('FILE_REQUIRED', 'CSV file is required', 400);

    const text = req.file.buffer.toString('utf-8');
    const rows = parseCSV(text);
    if (rows.length < 2) {
        throw new AppError('EMPTY_FILE', 'CSV file has no data rows', 400);
    }

    const EXPECTED_HEADERS = ['name', 'type', 'sku', 'barcode', 'price', 'cost', 'unit', 'category', 'active', 'lowstockthreshold'];
    const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));
    const col = (name: string) => headers.indexOf(name);

    if (col('name') === -1 || col('price') === -1 || col('unit') === -1) {
        throw new AppError('INVALID_HEADERS', 'CSV must include at least: name, price, unit', 400);
    }

    let imported = 0;
    let failed = 0;
    const errors: Array<{ row: number; message: string }> = [];

    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const rowNum = i + 1;
        try {
            const raw = {
                name: r[col('name')]?.trim(),
                type: (r[col('type')]?.trim().toUpperCase() || 'READY_MADE') as 'READY_MADE' | 'RECIPE',
                sku: r[col('sku')]?.trim() || null,
                barcode: r[col('barcode')]?.trim() || null,
                price: Number(r[col('price')]?.trim()),
                cost: r[col('cost')]?.trim() ? Number(r[col('cost')]?.trim()) : null,
                unit: r[col('unit')]?.trim() || 'pcs',
                category: r[col('category')]?.trim() || null,
                active: r[col('active')]?.trim().toLowerCase() === 'false' ? false : undefined,
                lowStockThreshold: r[col('lowstockthreshold')]?.trim() ? Number(r[col('lowstockthreshold')]?.trim()) : null,
            };

            const payload = productCreateSchema.parse(raw);
            const { recipeLines, ...productData } = payload;
            await productService.create(storeId, productData, recipeLines);
            imported++;
        } catch (err: any) {
            failed++;
            const message = err?.errors?.[0]?.message ?? err?.message ?? 'Invalid row';
            errors.push({ row: rowNum, message });
        }
    }

    res.status(200).json({ imported, failed, errors });
});
