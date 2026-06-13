import { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { AuthRequest } from '../../middlewares/auth';
import { ingredientCreateSchema, ingredientUpdateSchema } from './ingredient.schemas';
import { ingredientService } from './ingredient.service';
import { escapeCsvValue, parseCSV } from '../../shared/csv';

export const listIngredients = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const ingredients = await ingredientService.list(storeId);
    res.status(200).json({ ingredients });
});

export const getIngredient = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const ingredientId = req.params.ingredientId;
    if (!storeId || !ingredientId) {
        throw new AppError('BAD_REQUEST', 'Store and ingredient are required', 400);
    }

    const ingredient = await ingredientService.get(storeId, ingredientId);
    res.status(200).json({ ingredient });
});

export const createIngredient = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) {
        throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    }

    const payload = ingredientCreateSchema.parse(req.body);
    const ingredient = await ingredientService.create(storeId, payload);
    res.status(201).json({ ingredient });
});

export const updateIngredient = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const ingredientId = req.params.ingredientId;
    if (!storeId || !ingredientId) {
        throw new AppError('BAD_REQUEST', 'Store and ingredient are required', 400);
    }

    const payload = ingredientUpdateSchema.parse(req.body);
    const ingredient = await ingredientService.update(storeId, ingredientId, payload);
    res.status(200).json({ ingredient });
});

export const deleteIngredient = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    const ingredientId = req.params.ingredientId;
    if (!storeId || !ingredientId) {
        throw new AppError('BAD_REQUEST', 'Store and ingredient are required', 400);
    }

    await ingredientService.remove(storeId, ingredientId);
    res.status(204).send();
});

export const exportIngredients = asyncHandler(async (req: AuthRequest, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);

    const ingredients = await ingredientService.list(storeId);

    const rows: Array<Array<string | number | boolean | null | undefined>> = [
        ['Name', 'Unit', 'Category', 'Cost Per Unit', 'Purchase Unit', 'Purchase Unit Size', 'Active', 'Low Stock Threshold'],
        ...ingredients.map((ing) => [
            ing.name,
            ing.unit,
            ing.category,
            Number(ing.costPerUnit),
            ing.purchaseUnit,
            ing.purchaseUnitSize != null ? Number(ing.purchaseUnitSize) : null,
            ing.active,
            ing.lowStockThreshold != null ? Number(ing.lowStockThreshold) : null,
        ]),
    ];

    const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
    const filename = `ingredients-${storeId}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
});

export const importIngredients = asyncHandler(async (req: AuthRequest & { file?: Express.Multer.File }, res: Response) => {
    const storeId = req.params.storeId;
    if (!storeId) throw new AppError('STORE_REQUIRED', 'Store is required', 400);
    if (!req.file) throw new AppError('FILE_REQUIRED', 'CSV file is required', 400);

    const text = req.file.buffer.toString('utf-8');
    const rows = parseCSV(text);
    if (rows.length < 2) {
        throw new AppError('EMPTY_FILE', 'CSV file has no data rows', 400);
    }

    const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s_]+/g, ''));
    const col = (name: string) => headers.indexOf(name);

    const colCost = () => {
        const idx = col('costperunit');
        return idx !== -1 ? idx : col('cost');
    };

    if (col('name') === -1 || colCost() === -1) {
        throw new AppError('INVALID_HEADERS', 'CSV must include at least: name and cost_per_unit', 400);
    }

    // Pre-load existing ingredients by name for upsert lookup
    const existingIngredients = await ingredientService.list(storeId);
    const existingByName = new Map(existingIngredients.map((ing) => [ing.name.toLowerCase().trim(), ing]));

    let imported = 0;
    let updated = 0;
    let failed = 0;
    const errors: Array<{ row: number; message: string }> = [];

    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const rowNum = i + 1;
        try {
            const categoryRaw = r[col('category')]?.trim().toUpperCase();
            const raw = {
                name: r[col('name')]?.trim(),
                unit: r[col('unit')]?.trim() || 'pcs',
                category: categoryRaw ? (categoryRaw as 'RAW_MATERIAL' | 'PACKAGING') : undefined,
                costPerUnit: Number(r[colCost()]?.trim()),
                purchaseUnit: r[col('purchaseunit')]?.trim() || null,
                purchaseUnitSize: r[col('purchaseunitsize')]?.trim() ? Number(r[col('purchaseunitsize')]?.trim()) : null,
                active: r[col('active')]?.trim().toLowerCase() === 'false' ? false : undefined,
                lowStockThreshold: r[col('lowstockthreshold')]?.trim() ? Number(r[col('lowstockthreshold')]?.trim()) : null,
            };

            const payload = ingredientCreateSchema.parse(raw);

            const existing = existingByName.get((raw.name ?? '').toLowerCase().trim());
            if (existing) {
                await ingredientService.update(storeId, existing.id, payload);
                updated++;
            } else {
                await ingredientService.create(storeId, payload);
                imported++;
            }
        } catch (err: any) {
            failed++;
            const message = err?.errors?.[0]?.message ?? err?.message ?? 'Invalid row';
            errors.push({ row: rowNum, message });
        }
    }

    res.status(200).json({ imported, updated, failed, errors });
});
