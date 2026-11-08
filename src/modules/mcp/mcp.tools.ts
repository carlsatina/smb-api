import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpTokenAccess, Prisma } from '@prisma/client';
import { z, ZodError } from 'zod';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';
import { parseSalesChannels } from '../../shared/salesChannels';
import { parseSubcategoryOptions } from '../../shared/subcategories';
import { ingredientService } from '../ingredients/ingredient.service';
import { ingredientCreateSchema, ingredientUpdateSchema } from '../ingredients/ingredient.schemas';
import { productService } from '../products/product.service';
import { productCreateSchema, productUpdateSchema } from '../products/product.schemas';
import { recipeService } from '../recipes/recipe.service';
import { recipeLinesUpdateSchema } from '../recipes/recipe.schemas';
import { assertCanWrite, McpContext, resolveStore } from './mcp.auth';

// Sales, payments, team members and secrets (AI key, billing) are deliberately
// not reachable from here: the server only covers store settings (read-only),
// ingredients, products and recipes.

const MAX_LIST = 500;

const num = (value: Prisma.Decimal | number | null | undefined) => (value == null ? null : Number(value));

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

const toolError = (error: unknown) => {
    let message = 'Something went wrong.';
    if (error instanceof AppError) {
        message = error.message;
    } else if (error instanceof ZodError) {
        message = `Invalid input: ${error.issues.map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`).join('; ')}`;
    }
    return { isError: true, content: [{ type: 'text' as const, text: message }] };
};

// Every tool returns a readable error instead of failing the whole MCP request.
const safe =
    <A>(handler: (args: A) => Promise<ReturnType<typeof json>>) =>
    async (args: A) => {
        try {
            return await handler(args);
        } catch (error) {
            return toolError(error);
        }
    };

const matches = (query: string | undefined, ...values: Array<string | null | undefined>) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return values.some((value) => value?.toLowerCase().includes(q));
};

type IngredientRow = Awaited<ReturnType<typeof ingredientService.get>>;
const ingredientOut = (ingredient: IngredientRow) => ({
    id: ingredient.id,
    name: ingredient.name,
    unit: ingredient.unit,
    category: ingredient.category,
    costPerUnit: num(ingredient.costPerUnit),
    purchaseUnit: ingredient.purchaseUnit,
    purchaseUnitSize: num(ingredient.purchaseUnitSize),
    lowStockThreshold: num(ingredient.lowStockThreshold),
    active: ingredient.active,
});

type ProductRow = Awaited<ReturnType<typeof productService.get>>;
const productOut = (product: ProductRow) => ({
    id: product.id,
    name: product.name,
    type: product.type,
    price: num(product.price),
    cost: num(product.cost),
    unit: product.unit,
    category: product.category,
    subcategory: product.subcategory,
    sku: product.sku,
    barcode: product.barcode,
    channelPrices: product.channelPrices,
    unavailableChannels: product.unavailableChannels,
    lowStockThreshold: num(product.lowStockThreshold),
    active: product.active,
    recipeLineCount: product.recipeLineCount,
});

type RecipeLines = Awaited<ReturnType<typeof recipeService.listLines>>;
const recipeOut = (lines: RecipeLines) => {
    const out = lines.map((line) => {
        const qty = Number(line.qtyPerProductUnit);
        const cost = num(line.ingredient?.costPerUnit) ?? 0;
        return {
            ingredientId: line.ingredientId,
            ingredientName: line.ingredient?.name ?? null,
            unit: line.ingredient?.unit ?? null,
            qtyPerProductUnit: qty,
            lineCost: Number((qty * cost).toFixed(4)),
        };
    });
    return {
        lines: out,
        estimatedCostPerUnit: Number(out.reduce((sum, line) => sum + line.lineCost, 0).toFixed(2)),
    };
};

/** Keeps only the fields the caller actually sent so updates stay partial. */
const defined = <T extends Record<string, unknown>>(value: T) =>
    Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;

const audit = async (
    context: McpContext,
    storeId: string,
    action: string,
    entityType: string,
    entityId: string,
    meta: Record<string, unknown>
) => {
    await prisma.auditLog.create({
        data: {
            storeId,
            actorId: context.userId,
            action,
            entityType,
            entityId,
            meta: { via: 'MCP', tokenId: context.tokenId, tokenName: context.tokenName, ...meta } as Prisma.InputJsonValue,
        },
    });
};

// ── Input shapes (described for the AI; validated again by the module schemas) ──

const storeIdInput = z
    .string()
    .min(1)
    .optional()
    .describe('Store id from list_stores. Optional when the token covers a single store.');

const ingredientFields = {
    name: z.string().min(1).describe('Ingredient name, e.g. "Fresh milk".'),
    unit: z.string().min(1).describe('Unit used in recipes, e.g. g, ml, pc. Should be one of the store unitOptions.'),
    category: z.enum(['RAW_MATERIAL', 'PACKAGING']).describe('RAW_MATERIAL, or PACKAGING for cups/lids/straws.'),
    costPerUnit: z.number().nonnegative().describe('Cost of one unit in the store currency.'),
    purchaseUnit: z.string().min(1).nullable().describe('Bulk unit it is bought in, e.g. "Gallon". null to clear.'),
    purchaseUnitSize: z.number().positive().nullable().describe('How many recipe units are in one purchase unit.'),
    lowStockThreshold: z.number().nonnegative().nullable().describe('Overrides the store low stock threshold.'),
    active: z.boolean().describe('Inactive ingredients are hidden from recipe pickers.'),
};

const recipeLineInput = z.object({
    ingredientId: z.string().min(1),
    qtyPerProductUnit: z.number().positive().describe('Amount used per unit sold, in the ingredient unit.'),
});

const productFields = {
    name: z.string().min(1),
    type: z.enum(['READY_MADE', 'RECIPE']).describe('READY_MADE is stocked and sold as-is; RECIPE deducts its ingredients per sale.'),
    price: z.number().nonnegative().describe('Walk-in selling price.'),
    cost: z.number().nonnegative().nullable().describe('Unit cost for ready-made products.'),
    unit: z.string().min(1).describe('e.g. pc, cup, bottle.'),
    category: z.string().min(1).nullable().describe('Should be one of the store categoryOptions.'),
    subcategory: z.string().min(1).nullable().describe('Must be configured under the category in store settings.'),
    sku: z.string().min(1).nullable(),
    barcode: z.string().min(1).nullable(),
    channelPrices: z.record(z.string(), z.number().nonnegative()).describe('Explicit per-channel prices, e.g. {"GRAB": 160}. Omitted channels use the channel markup.'),
    unavailableChannels: z.array(z.string()).describe('Channel keys this product is not sold on, e.g. ["GRAB"].'),
    lowStockThreshold: z.number().nonnegative().nullable(),
    active: z.boolean().describe('Only active products appear in the POS. RECIPE products need recipe lines first.'),
};

export const registerMcpTools = (server: McpServer, context: McpContext) => {
    // ── Read tools ──

    server.registerTool(
        'list_stores',
        {
            title: 'List stores',
            description: 'The stores this connection can access. Pass a store id as storeId to the other tools.',
            annotations: { readOnlyHint: true },
        },
        safe(async () =>
            json({
                stores: context.stores.map((store) => ({
                    id: store.id,
                    name: store.name,
                    type: store.storeType,
                    currency: store.currency,
                })),
            })
        )
    );

    server.registerTool(
        'get_store_settings',
        {
            title: 'Get store settings',
            description: 'Store profile and catalog settings: currency, timezone, tax, discount, units, categories, subcategories, payment methods and sales channels. Read-only.',
            inputSchema: { storeId: storeIdInput },
            annotations: { readOnlyHint: true },
        },
        safe(async (args) => {
            const { id: storeId } = resolveStore(context, args.storeId);
            const store = await prisma.store.findFirstOrThrow({
                where: { id: storeId, deletedAt: null },
                select: {
                    name: true,
                    storeType: true,
                    timezone: true,
                    currency: true,
                    lowStockThreshold: true,
                    defaultTaxRate: true,
                    defaultDiscount: true,
                    allowNegativeStock: true,
                    cashierSalesHistoryLimit: true,
                    paymentMethods: true,
                    unitOptions: true,
                    categoryOptions: true,
                    subcategoryOptions: true,
                    expenseCategoryOptions: true,
                    salesChannels: true,
                },
            });
            return json({
                ...store,
                lowStockThreshold: num(store.lowStockThreshold),
                taxRatePercent: num(store.defaultTaxRate),
                seniorPwdDiscountPercent: num(store.defaultDiscount),
                defaultTaxRate: undefined,
                defaultDiscount: undefined,
                subcategoryOptions: parseSubcategoryOptions(store.subcategoryOptions),
                salesChannels: parseSalesChannels(store.salesChannels),
            });
        })
    );

    server.registerTool(
        'list_ingredients',
        {
            title: 'List ingredients',
            description: 'Ingredients (raw materials and packaging) with unit, cost per unit and purchase unit.',
            inputSchema: {
                storeId: storeIdInput,
                search: z.string().optional().describe('Case-insensitive match on name or unit.'),
                category: z.enum(['RAW_MATERIAL', 'PACKAGING']).optional(),
                includeInactive: z.boolean().optional().describe('Defaults to true.'),
            },
            annotations: { readOnlyHint: true },
        },
        safe(async ({ storeId: requested, search, category, includeInactive = true }) => {
            const { id: storeId } = resolveStore(context, requested);
            const rows = (await ingredientService.list(storeId))
                .filter((i) => (includeInactive || i.active) && (!category || i.category === category))
                .filter((i) => matches(search, i.name, i.unit));
            return json({ total: rows.length, ingredients: rows.slice(0, MAX_LIST).map(ingredientOut) });
        })
    );

    server.registerTool(
        'get_ingredient',
        {
            title: 'Get ingredient',
            description: 'One ingredient by id.',
            inputSchema: { storeId: storeIdInput, ingredientId: z.string().min(1) },
            annotations: { readOnlyHint: true },
        },
        safe(async ({ storeId: requested, ingredientId }) => {
            const { id: storeId } = resolveStore(context, requested);
            return json(ingredientOut(await ingredientService.get(storeId, ingredientId)));
        })
    );

    server.registerTool(
        'list_products',
        {
            title: 'List products',
            description: 'Products with type, price, cost, category and channel pricing. Use get_product for a recipe breakdown.',
            inputSchema: {
                storeId: storeIdInput,
                search: z.string().optional().describe('Case-insensitive match on name, SKU, barcode or category.'),
                type: z.enum(['READY_MADE', 'RECIPE']).optional(),
                category: z.string().optional(),
                includeInactive: z.boolean().optional().describe('Defaults to true.'),
            },
            annotations: { readOnlyHint: true },
        },
        safe(async ({ storeId: requested, search, type, category, includeInactive = true }) => {
            const { id: storeId } = resolveStore(context, requested);
            const rows = (await productService.list(storeId))
                .filter((p) => (includeInactive || p.active) && (!type || p.type === type))
                .filter((p) => !category || p.category?.toLowerCase() === category.toLowerCase())
                .filter((p) => matches(search, p.name, p.sku, p.barcode, p.category));
            return json({ total: rows.length, products: rows.slice(0, MAX_LIST).map(productOut) });
        })
    );

    server.registerTool(
        'get_product',
        {
            title: 'Get product',
            description: 'One product by id, including recipe lines and estimated recipe cost for RECIPE products.',
            inputSchema: { storeId: storeIdInput, productId: z.string().min(1) },
            annotations: { readOnlyHint: true },
        },
        safe(async ({ storeId: requested, productId }) => {
            const { id: storeId } = resolveStore(context, requested);
            const product = await productService.get(storeId, productId);
            const recipe = product.type === 'RECIPE' ? recipeOut(await recipeService.listLines(storeId, productId)) : null;
            return json({ ...productOut(product), recipe });
        })
    );

    // Write tools are only offered to read & write tokens, so read-only
    // clients never see them.
    if (context.access !== McpTokenAccess.READ_WRITE) return;

    // ── Write tools ──

    server.registerTool(
        'create_ingredient',
        {
            title: 'Create ingredient',
            description: 'Adds an ingredient. It starts with zero stock.',
            inputSchema: {
                storeId: storeIdInput,
                ...ingredientFields,
                category: ingredientFields.category.optional(),
                purchaseUnit: ingredientFields.purchaseUnit.optional(),
                purchaseUnitSize: ingredientFields.purchaseUnitSize.optional(),
                lowStockThreshold: ingredientFields.lowStockThreshold.optional(),
                active: ingredientFields.active.optional(),
            },
        },
        safe(async ({ storeId: requested, ...args }) => {
            const { id: storeId } = resolveStore(context, requested);
            await assertCanWrite(context, storeId);
            const data = ingredientCreateSchema.parse(defined(args));
            const created = await ingredientService.create(storeId, data);
            await audit(context, storeId, 'MCP_INGREDIENT_CREATED', 'Ingredient', created.id, { name: created.name, changes: data });
            return json(ingredientOut(created));
        })
    );

    server.registerTool(
        'update_ingredient',
        {
            title: 'Update ingredient',
            description: 'Changes the given fields of an ingredient; omitted fields are left as they are. Cost changes affect recipe costs and margins.',
            inputSchema: {
                storeId: storeIdInput,
                ingredientId: z.string().min(1),
                ...Object.fromEntries(Object.entries(ingredientFields).map(([key, schema]) => [key, schema.optional()])),
            } as { storeId: typeof storeIdInput; ingredientId: z.ZodString } & { [K in keyof typeof ingredientFields]: z.ZodOptional<(typeof ingredientFields)[K]> },
        },
        safe(async ({ storeId: requested, ingredientId, ...fields }) => {
            const { id: storeId } = resolveStore(context, requested);
            await assertCanWrite(context, storeId);
            const data = ingredientUpdateSchema.parse(defined(fields));
            const before = ingredientOut(await ingredientService.get(storeId, ingredientId));
            const updated = await ingredientService.update(storeId, ingredientId, data);
            const previous = Object.fromEntries(Object.keys(data).map((key) => [key, before[key as keyof typeof before]]));
            await audit(context, storeId, 'MCP_INGREDIENT_UPDATED', 'Ingredient', ingredientId, { name: updated.name, changes: data, previous });
            return json(ingredientOut(updated));
        })
    );

    server.registerTool(
        'create_product',
        {
            title: 'Create product',
            description: 'Adds a product. RECIPE products can include recipe lines; without them they are created inactive.',
            inputSchema: {
                storeId: storeIdInput,
                name: productFields.name,
                type: productFields.type,
                price: productFields.price,
                unit: productFields.unit,
                cost: productFields.cost.optional(),
                category: productFields.category.optional(),
                subcategory: productFields.subcategory.optional(),
                sku: productFields.sku.optional(),
                barcode: productFields.barcode.optional(),
                channelPrices: productFields.channelPrices.optional(),
                unavailableChannels: productFields.unavailableChannels.optional(),
                lowStockThreshold: productFields.lowStockThreshold.optional(),
                active: productFields.active.optional(),
                recipeLines: z.array(recipeLineInput).optional().describe('RECIPE products only.'),
            },
        },
        safe(async ({ storeId: requested, ...args }) => {
            const { id: storeId } = resolveStore(context, requested);
            await assertCanWrite(context, storeId);
            const { recipeLines, ...data } = productCreateSchema.parse(defined(args));
            const created = await productService.create(storeId, data, recipeLines);
            await audit(context, storeId, 'MCP_PRODUCT_CREATED', 'Product', created.id, { name: created.name, changes: args });
            return json(productOut(created));
        })
    );

    server.registerTool(
        'update_product',
        {
            title: 'Update product',
            description: 'Changes the given fields of a product; omitted fields are left as they are. Price changes apply to the POS immediately.',
            inputSchema: {
                storeId: storeIdInput,
                productId: z.string().min(1),
                ...Object.fromEntries(Object.entries(productFields).map(([key, schema]) => [key, schema.optional()])),
            } as { storeId: typeof storeIdInput; productId: z.ZodString } & { [K in keyof typeof productFields]: z.ZodOptional<(typeof productFields)[K]> },
        },
        safe(async ({ storeId: requested, productId, ...fields }) => {
            const { id: storeId } = resolveStore(context, requested);
            await assertCanWrite(context, storeId);
            const { recipeLines, ...data } = productUpdateSchema.parse(defined(fields));
            const before = productOut(await productService.get(storeId, productId));
            const updated = await productService.update(storeId, productId, data, recipeLines);
            const previous = Object.fromEntries(Object.keys(data).map((key) => [key, before[key as keyof typeof before]]));
            await audit(context, storeId, 'MCP_PRODUCT_UPDATED', 'Product', productId, { name: updated.name, changes: data, previous });
            return json(productOut(updated));
        })
    );

    server.registerTool(
        'set_recipe',
        {
            title: 'Set recipe',
            description: 'Replaces all recipe lines of a RECIPE product. An empty list removes the recipe and deactivates the product.',
            inputSchema: {
                storeId: storeIdInput,
                productId: z.string().min(1),
                lines: z.array(recipeLineInput),
            },
        },
        safe(async ({ storeId: requested, productId, lines }) => {
            const { id: storeId } = resolveStore(context, requested);
            await assertCanWrite(context, storeId);
            const parsed = recipeLinesUpdateSchema.parse({ lines });
            const product = await productService.get(storeId, productId);
            const previous = recipeOut(await recipeService.listLines(storeId, productId));
            const updated = recipeOut(await recipeService.replaceLines(storeId, productId, parsed.lines));
            await audit(context, storeId, 'MCP_RECIPE_UPDATED', 'Product', productId, {
                name: product.name,
                changes: { lines: updated.lines.map((l) => ({ ingredient: l.ingredientName, qty: l.qtyPerProductUnit })) },
                previous: { lines: previous.lines.map((l) => ({ ingredient: l.ingredientName, qty: l.qtyPerProductUnit })) },
            });
            return json({ productId, name: product.name, ...updated });
        })
    );
};
