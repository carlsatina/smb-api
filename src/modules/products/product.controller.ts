import { Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler';
import { AppError } from '../../shared/errors';
import { AuthRequest } from '../../middlewares/auth';
import { productCreateSchema, productUpdateSchema } from './product.schemas';
import { productService } from './product.service';
import { recipeRepository } from '../recipes/recipe.repository';
import { ingredientRepository } from '../ingredients/ingredient.repository';
import { escapeCsvValue, parseCSV } from '../../shared/csv';

// Recipe lines are encoded in a single "Recipe" CSV column as
// "Ingredient Name:qty | Ingredient Name:qty". Names are resolved against the
// store's ingredients on import.
const RECIPE_LINE_SEPARATOR = '|';

const serializeRecipeLines = (
    lines: Array<{ ingredient: { name: string }; qtyPerProductUnit: unknown }>
): string =>
    lines
        .map((line) => `${line.ingredient.name}:${Number(line.qtyPerProductUnit)}`)
        .join(` ${RECIPE_LINE_SEPARATOR} `);

const parseRecipeCell = (
    cell: string,
    ingredientsByName: Map<string, { id: string }>
): Array<{ ingredientId: string; qtyPerProductUnit: number }> => {
    const parts = cell
        .split(RECIPE_LINE_SEPARATOR)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

    return parts.map((part) => {
        const sep = part.lastIndexOf(':');
        if (sep === -1) {
            throw new AppError('INVALID_RECIPE_LINE', `Recipe entry "${part}" must be in "Ingredient Name:qty" format.`, 400);
        }
        const name = part.slice(0, sep).trim();
        const qty = Number(part.slice(sep + 1).trim());
        if (!name) {
            throw new AppError('INVALID_RECIPE_LINE', `Recipe entry "${part}" is missing an ingredient name.`, 400);
        }
        if (!Number.isFinite(qty) || qty <= 0) {
            throw new AppError('INVALID_RECIPE_LINE', `Recipe entry "${part}" has an invalid quantity.`, 400);
        }
        const ingredient = ingredientsByName.get(name.toLowerCase());
        if (!ingredient) {
            throw new AppError('UNKNOWN_INGREDIENT', `Ingredient "${name}" was not found. Add it before importing this recipe.`, 400);
        }
        return { ingredientId: ingredient.id, qtyPerProductUnit: qty };
    });
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

    // Map each recipe product to its serialized recipe lines for the Recipe column.
    const recipes = await recipeRepository.listByStoreWithLines(storeId);
    const recipeByProductId = new Map(
        recipes.map((recipe) => [recipe.productId, serializeRecipeLines(recipe.lines)])
    );

    const rows: Array<Array<string | number | boolean | null | undefined>> = [
        ['Name', 'Type', 'SKU', 'Barcode', 'Price', 'Cost', 'Unit', 'Category', 'Active', 'Low Stock Threshold', 'Recipe'],
        ...products.map((p) => [p.name, p.type, p.sku, p.barcode, Number(p.price), p.cost != null ? Number(p.cost) : null, p.unit, p.category, p.active, p.lowStockThreshold != null ? Number(p.lowStockThreshold) : null, recipeByProductId.get(p.id) ?? '']),
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

    const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s_]+/g, ''));
    const col = (name: string) => headers.indexOf(name);

    // Support common column name aliases
    const colName = () => {
        const idx = col('name');
        return idx !== -1 ? idx : col('productname');
    };

    if (colName() === -1 || col('price') === -1) {
        throw new AppError('INVALID_HEADERS', 'CSV must include at least: name (or product_name) and price', 400);
    }

    // Pre-load existing products by name for upsert lookup
    const existingProducts = await productService.list(storeId);
    const existingByName = new Map(existingProducts.map((p) => [p.name.toLowerCase().trim(), p]));

    // Pre-load ingredients so the Recipe column can resolve names to IDs.
    const ingredients = await ingredientRepository.listByStore(storeId);
    const ingredientsByName = new Map(ingredients.map((ing) => [ing.name.toLowerCase().trim(), ing]));
    const recipeCol = col('recipe');

    let imported = 0;
    let updated = 0;
    let failed = 0;
    const errors: Array<{ row: number; message: string }> = [];

    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const rowNum = i + 1;
        try {
            const raw = {
                name: r[colName()]?.trim(),
                type: (r[col('type')]?.trim().toUpperCase() || 'READY_MADE') as 'READY_MADE' | 'RECIPE',
                sku: r[col('sku')]?.trim() || null,
                barcode: r[col('barcode')]?.trim() || null,
                price: Number(r[col('price')]?.trim()),
                cost: r[col('cost')]?.trim() ? Number(r[col('cost')]?.trim()) : null,
                unit: r[col('unit')]?.trim() || 'pcs',
                category: r[col('category')]?.trim() || null,
                active: (() => {
                    const v = r[col('active')]?.trim().toLowerCase();
                    return v === 'true' ? true : v === 'false' ? false : undefined;
                })(),
                lowStockThreshold: r[col('lowstockthreshold')]?.trim() ? Number(r[col('lowstockthreshold')]?.trim()) : null,
            };

            const payload = productCreateSchema.parse(raw);
            const { recipeLines: _ignoredRecipeLines, ...productData } = payload;

            // Recipe lines come from the dedicated Recipe column, resolved by name.
            // An empty cell means "leave the recipe unchanged" rather than clearing it.
            const recipeCell = recipeCol !== -1 ? (r[recipeCol]?.trim() ?? '') : '';
            const recipeLines = recipeCell ? parseRecipeCell(recipeCell, ingredientsByName) : undefined;

            const existing = existingByName.get((raw.name ?? '').toLowerCase().trim());
            if (existing) {
                await productService.update(storeId, existing.id, productData, recipeLines);
                updated++;
            } else {
                await productService.create(storeId, productData, recipeLines);
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
