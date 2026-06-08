import { randomUUID } from 'crypto';
import {
    ItemType,
    MovementType,
    PaymentMethod,
    Prisma,
    ProductType,
    SaleStatus,
} from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';
import { saleRepository } from './sale.repository';

type SaleItemInput = {
    productId: string;
    qty: number;
    unitPrice: number;
    discount?: number;
    tax?: number;
};

type MovementDelta = {
    itemType: ItemType;
    itemId: string;
    qtyDelta: number;
};

type RecipeLine = {
    ingredientId: string;
    qtyPerProductUnit: number;
};

const normalizeDecimal = (value: Prisma.Decimal | null | undefined) => Number(value ?? 0);

const roundMoney = (value: number) => Number(value.toFixed(2));

const ensureStore = async (storeId: string) => {
    const store = await prisma.store.findFirst({
        where: {
            id: storeId,
            deletedAt: null,
        },
        select: {
            id: true,
            allowNegativeStock: true,
        },
    });

    if (!store) {
        throw new AppError('NOT_FOUND', 'Store not found', 404);
    }

    return store;
};

const loadRecipeLines = async (storeId: string, productIds: string[]) => {
    if (productIds.length === 0) {
        return new Map<string, RecipeLine[]>();
    }

    const lines = await prisma.recipeLine.findMany({
        where: {
            recipe: {
                storeId,
                deletedAt: null,
                productId: {
                    in: productIds,
                },
            },
            ingredient: {
                deletedAt: null,
            },
        },
        select: {
            ingredientId: true,
            qtyPerProductUnit: true,
            recipe: {
                select: {
                    productId: true,
                },
            },
        },
    });

    const map = new Map<string, RecipeLine[]>();
    lines.forEach((line) => {
        const productId = line.recipe.productId;
        const existing = map.get(productId) ?? [];
        existing.push({
            ingredientId: line.ingredientId,
            qtyPerProductUnit: normalizeDecimal(line.qtyPerProductUnit),
        });
        map.set(productId, existing);
    });

    return map;
};

const calculateSaleItems = (items: SaleItemInput[], productMap: Map<string, { name: string }>) => {
    type SaleItemDraft = Omit<Prisma.SaleItemCreateManyInput, 'saleId'>;
    const saleItems: SaleItemDraft[] = [];
    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;

    items.forEach((item) => {
        const product = productMap.get(item.productId);
        if (!product) {
            throw new AppError('PRODUCT_NOT_FOUND', 'Product not found', 404);
        }

        const qty = item.qty;
        const unitPrice = item.unitPrice;
        const discount = item.discount ?? 0;
        const tax = item.tax ?? 0;

        if (discount < 0 || tax < 0) {
            throw new AppError('INVALID_AMOUNT', 'Discount and tax must be non-negative.', 400);
        }

        const lineSubtotal = roundMoney(qty * unitPrice);
        if (discount > lineSubtotal) {
            throw new AppError('INVALID_DISCOUNT', 'Discount exceeds line subtotal.', 400);
        }

        const lineTotal = roundMoney(lineSubtotal - discount + tax);
        if (lineTotal < 0) {
            throw new AppError('INVALID_TOTAL', 'Line total must be non-negative.', 400);
        }

        subtotal += lineSubtotal;
        discountTotal += discount;
        taxTotal += tax;

        saleItems.push({
            productId: item.productId,
            qty: new Prisma.Decimal(qty),
            unitPrice: new Prisma.Decimal(roundMoney(unitPrice)),
            discount: new Prisma.Decimal(roundMoney(discount)),
            tax: new Prisma.Decimal(roundMoney(tax)),
            total: new Prisma.Decimal(lineTotal),
            nameSnapshot: product.name,
        });
    });

    subtotal = roundMoney(subtotal);
    discountTotal = roundMoney(discountTotal);
    taxTotal = roundMoney(taxTotal);

    const total = roundMoney(subtotal - discountTotal + taxTotal);

    return {
        saleItems,
        totals: {
            subtotal,
            discount: discountTotal,
            tax: taxTotal,
            total,
        },
    };
};

const buildMovementDeltas = (
    items: SaleItemInput[],
    products: Array<{
        id: string;
        type: ProductType;
    }>,
    recipeLinesByProduct: Map<string, RecipeLine[]>,
    direction: 1 | -1
) => {
    const productMap = new Map(products.map((product) => [product.id, product]));
    const deltaMap = new Map<string, MovementDelta>();

    const addDelta = (itemType: ItemType, itemId: string, qtyDelta: number) => {
        const key = `${itemType}:${itemId}`;
        const existing = deltaMap.get(key);
        if (existing) {
            existing.qtyDelta += qtyDelta;
        } else {
            deltaMap.set(key, { itemType, itemId, qtyDelta });
        }
    };

    items.forEach((item) => {
        const product = productMap.get(item.productId);
        if (!product) {
            throw new AppError('PRODUCT_NOT_FOUND', 'Product not found', 404);
        }

        if (product.type === ProductType.READY_MADE) {
            addDelta(ItemType.PRODUCT, product.id, direction * -1 * item.qty);
            return;
        }

        const recipeLines = recipeLinesByProduct.get(product.id) ?? [];
        if (recipeLines.length === 0) {
            throw new AppError(
                'RECIPE_LINES_REQUIRED',
                'Recipe products must have at least one recipe line before sale.',
                400
            );
        }

        recipeLines.forEach((line) => {
            addDelta(
                ItemType.INGREDIENT,
                line.ingredientId,
                direction * -1 * item.qty * line.qtyPerProductUnit
            );
        });
    });

    return Array.from(deltaMap.values());
};

const ensureStockAvailable = async (
    storeId: string,
    allowNegativeStock: boolean,
    movementDeltas: MovementDelta[],
    productNames: Map<string, string>,
    ingredientNames: Map<string, string>
) => {
    if (allowNegativeStock) {
        return;
    }

    const productIds = movementDeltas
        .filter((delta) => delta.itemType === ItemType.PRODUCT)
        .map((delta) => delta.itemId);
    const ingredientIds = movementDeltas
        .filter((delta) => delta.itemType === ItemType.INGREDIENT)
        .map((delta) => delta.itemId);

    const [productSums, ingredientSums] = await Promise.all([
        productIds.length
            ? prisma.inventoryMovement.groupBy({
                  by: ['itemId'],
                  where: {
                      storeId,
                      itemType: ItemType.PRODUCT,
                      itemId: { in: productIds },
                  },
                  _sum: { qtyDelta: true },
              })
            : Promise.resolve([]),
        ingredientIds.length
            ? prisma.inventoryMovement.groupBy({
                  by: ['itemId'],
                  where: {
                      storeId,
                      itemType: ItemType.INGREDIENT,
                      itemId: { in: ingredientIds },
                  },
                  _sum: { qtyDelta: true },
              })
            : Promise.resolve([]),
    ]);

    const productStock = new Map(
        productSums.map((row) => [row.itemId, normalizeDecimal(row._sum.qtyDelta)])
    );
    const ingredientStock = new Map(
        ingredientSums.map((row) => [row.itemId, normalizeDecimal(row._sum.qtyDelta)])
    );

    movementDeltas.forEach((delta) => {
        const current =
            delta.itemType === ItemType.PRODUCT
                ? productStock.get(delta.itemId) ?? 0
                : ingredientStock.get(delta.itemId) ?? 0;
        const nextQty = current + delta.qtyDelta;
        if (nextQty < 0) {
            const name =
                delta.itemType === ItemType.PRODUCT
                    ? productNames.get(delta.itemId)
                    : ingredientNames.get(delta.itemId);
            throw new AppError('NEGATIVE_STOCK', 'Stock would go negative for this sale.', 400, {
                itemType: delta.itemType,
                itemId: delta.itemId,
                name,
                currentQty: current,
                requestedDelta: delta.qtyDelta,
            });
        }
    });
};

const mapSaleSummary = (
    sale: Prisma.SaleGetPayload<{
        include: {
            cashier: { select: { id: true; fullName: true; email: true } };
            items: { select: { id: true; nameSnapshot: true; qty: true } };
            _count: { select: { items: true } };
        };
    }>
) => ({
    id: sale.id,
    receiptNumber: sale.receiptNumber,
    status: sale.status,
    subtotal: normalizeDecimal(sale.subtotal),
    discount: normalizeDecimal(sale.discount),
    tax: normalizeDecimal(sale.tax),
    total: normalizeDecimal(sale.total),
    paymentMethod: sale.paymentMethod,
    createdAt: sale.createdAt,
    finalizedAt: sale.finalizedAt,
    voidedAt: sale.voidedAt,
    itemCount: sale._count.items,
    cashier: sale.cashier,
    items: sale.items.map((item) => ({
        id: item.id,
        name: item.nameSnapshot,
        qty: normalizeDecimal(item.qty),
    })),
});

const mapSaleDetail = (
    sale: Prisma.SaleGetPayload<{
        include: {
            cashier: { select: { id: true; fullName: true; email: true } };
            items: {
                include: {
                    product: { select: { id: true; name: true; sku: true; unit: true; type: true } };
                };
            };
        };
    }>
) => ({
    id: sale.id,
    receiptNumber: sale.receiptNumber,
    status: sale.status,
    subtotal: normalizeDecimal(sale.subtotal),
    discount: normalizeDecimal(sale.discount),
    tax: normalizeDecimal(sale.tax),
    total: normalizeDecimal(sale.total),
    paymentMethod: sale.paymentMethod,
    createdAt: sale.createdAt,
    finalizedAt: sale.finalizedAt,
    voidedAt: sale.voidedAt,
    cashier: sale.cashier,
    items: sale.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.nameSnapshot,
        qty: normalizeDecimal(item.qty),
        unitPrice: normalizeDecimal(item.unitPrice),
        discount: normalizeDecimal(item.discount),
        tax: normalizeDecimal(item.tax),
        total: normalizeDecimal(item.total),
        product: item.product
            ? {
                  id: item.product.id,
                  name: item.product.name,
                  sku: item.product.sku,
                  unit: item.product.unit,
                  type: item.product.type,
              }
            : null,
    })),
});

const getNextReceiptNumber = async (tx: Prisma.TransactionClient, storeId: string) => {
    const result = await tx.sale.aggregate({
        where: {
            storeId,
            deletedAt: null,
        },
        _max: {
            receiptNumber: true,
        },
    });

    return (result._max.receiptNumber ?? 0) + 1;
};

export const saleService = {
    list: async (
        storeId: string,
        filters: {
            status?: SaleStatus;
            from?: Date;
            to?: Date;
            cashierId?: string;
            paymentMethod?: PaymentMethod;
            productId?: string;
        },
        page: number,
        pageSize: number
    ) => {
        const skip = (page - 1) * pageSize;
        const saleFilters = { storeId, ...filters };
        const [total, sales] = await Promise.all([
            saleRepository.countSales(saleFilters),
            saleRepository.listSales(saleFilters, skip, pageSize),
        ]);

        return {
            sales: sales.map(mapSaleSummary),
            total,
            page,
            pageSize,
        };
    },
    get: async (storeId: string, saleId: string) => {
        const sale = await saleRepository.getById(storeId, saleId);
        if (!sale) {
            throw new AppError('NOT_FOUND', 'Sale not found', 404);
        }

        return mapSaleDetail(sale);
    },
    finalize: async (storeId: string, userId: string, payload: { items: SaleItemInput[]; paymentMethod: PaymentMethod }) => {
        if (!payload.items.length) {
            throw new AppError('INVALID_ITEMS', 'Sale must include at least one item.', 400);
        }

        const store = await ensureStore(storeId);
        const uniqueProductIds = Array.from(new Set(payload.items.map((item) => item.productId)));

        const products = await prisma.product.findMany({
            where: {
                storeId,
                deletedAt: null,
                id: { in: uniqueProductIds },
            },
            select: {
                id: true,
                name: true,
                type: true,
                active: true,
                cost: true,
            },
        });

        if (products.length !== uniqueProductIds.length) {
            throw new AppError('PRODUCT_NOT_FOUND', 'One or more products are missing.', 404);
        }

        const inactiveProduct = products.find((product) => !product.active);
        if (inactiveProduct) {
            throw new AppError('PRODUCT_INACTIVE', 'Inactive products cannot be sold.', 400);
        }

        const productMap = new Map(products.map((product) => [product.id, product]));
        const recipeProductIds = products
            .filter((product) => product.type === ProductType.RECIPE)
            .map((product) => product.id);

        const recipeLinesByProduct = await loadRecipeLines(storeId, recipeProductIds);

        recipeProductIds.forEach((productId) => {
            const lines = recipeLinesByProduct.get(productId) ?? [];
            if (lines.length === 0) {
                throw new AppError(
                    'RECIPE_LINES_REQUIRED',
                    'Recipe products must have at least one recipe line before sale.',
                    400
                );
            }
        });

        const { saleItems, totals } = calculateSaleItems(payload.items, new Map(products.map((p) => [p.id, { name: p.name }])));

        const movementDeltas = buildMovementDeltas(
            payload.items,
            products.map((product) => ({ id: product.id, type: product.type })),
            recipeLinesByProduct,
            1
        );

        const ingredientIds = movementDeltas
            .filter((delta) => delta.itemType === ItemType.INGREDIENT)
            .map((delta) => delta.itemId);
        const ingredients = ingredientIds.length
            ? await prisma.ingredient.findMany({
                  where: {
                      id: { in: ingredientIds },
                      storeId,
                      deletedAt: null,
                  },
                  select: {
                      id: true,
                      name: true,
                      costPerUnit: true,
                  },
              })
            : [];

        if (ingredientIds.length && ingredients.length !== new Set(ingredientIds).size) {
            throw new AppError('INGREDIENT_NOT_FOUND', 'One or more ingredients are missing.', 404);
        }

        const productNames = new Map(products.map((product) => [product.id, product.name]));
        const ingredientNames = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient.name]));

        await ensureStockAvailable(storeId, store.allowNegativeStock, movementDeltas, productNames, ingredientNames);

        const productCostMap = new Map(
            products.map((product) => [product.id, product.cost ? normalizeDecimal(product.cost) : null])
        );
        const ingredientCostMap = new Map(
            ingredients.map((ingredient) => [ingredient.id, normalizeDecimal(ingredient.costPerUnit)])
        );

        const sale = await prisma.$transaction(async (tx) => {
            const receiptNumber = await getNextReceiptNumber(tx, storeId);

            const created = await tx.sale.create({
                data: {
                    storeId,
                    cashierId: userId,
                    status: SaleStatus.FINALIZED,
                    receiptNumber,
                    subtotal: new Prisma.Decimal(totals.subtotal),
                    discount: new Prisma.Decimal(totals.discount),
                    tax: new Prisma.Decimal(totals.tax),
                    total: new Prisma.Decimal(totals.total),
                    paymentMethod: payload.paymentMethod,
                    finalizedAt: new Date(),
                },
            });

            await tx.saleItem.createMany({
                data: saleItems.map((item) => ({
                    ...item,
                    saleId: created.id,
                })),
            });

            if (movementDeltas.length) {
                await tx.inventoryMovement.createMany({
                    data: movementDeltas.map((delta) => ({
                        storeId,
                        itemType: delta.itemType,
                        itemId: delta.itemId,
                        qtyDelta: new Prisma.Decimal(delta.qtyDelta),
                        unitCost:
                            delta.itemType === ItemType.PRODUCT
                                ? productCostMap.get(delta.itemId) !== null
                                    ? new Prisma.Decimal(productCostMap.get(delta.itemId) ?? 0)
                                    : null
                                : new Prisma.Decimal(ingredientCostMap.get(delta.itemId) ?? 0),
                        type: MovementType.SALE,
                        referenceType: 'SALE',
                        referenceId: created.id,
                        createdById: userId,
                    })),
                });
            }

            return created;
        });

        const finalized = await saleRepository.getById(storeId, sale.id);
        if (!finalized) {
            throw new AppError('NOT_FOUND', 'Sale not found', 404);
        }

        return mapSaleDetail(finalized);
    },
    voidSale: async (storeId: string, userId: string, saleId: string) => {
        const sale = await saleRepository.getById(storeId, saleId);
        if (!sale) {
            throw new AppError('NOT_FOUND', 'Sale not found', 404);
        }

        if (sale.status !== SaleStatus.FINALIZED) {
            throw new AppError('INVALID_STATUS', 'Only finalized sales can be voided.', 400);
        }

        if (sale.voidedAt) {
            throw new AppError('ALREADY_VOIDED', 'Sale has already been voided.', 409);
        }

        const items = sale.items.map((item) => ({
            productId: item.productId,
            qty: normalizeDecimal(item.qty),
            unitPrice: normalizeDecimal(item.unitPrice),
            discount: normalizeDecimal(item.discount),
            tax: normalizeDecimal(item.tax),
        }));

        const products = await prisma.product.findMany({
            where: {
                storeId,
                deletedAt: null,
                id: { in: sale.items.map((item) => item.productId) },
            },
            select: {
                id: true,
                type: true,
                name: true,
                cost: true,
            },
        });

        const recipeProductIds = products
            .filter((product) => product.type === ProductType.RECIPE)
            .map((product) => product.id);

        const recipeLinesByProduct = await loadRecipeLines(storeId, recipeProductIds);

        const movementDeltas = buildMovementDeltas(
            items,
            products.map((product) => ({ id: product.id, type: product.type })),
            recipeLinesByProduct,
            -1
        );

        const ingredientIds = movementDeltas
            .filter((delta) => delta.itemType === ItemType.INGREDIENT)
            .map((delta) => delta.itemId);
        const ingredients = ingredientIds.length
            ? await prisma.ingredient.findMany({
                  where: {
                      id: { in: ingredientIds },
                      storeId,
                      deletedAt: null,
                  },
                  select: {
                      id: true,
                      costPerUnit: true,
                  },
              })
            : [];

        const productCostMap = new Map(
            products.map((product) => [product.id, product.cost ? normalizeDecimal(product.cost) : null])
        );
        const ingredientCostMap = new Map(
            ingredients.map((ingredient) => [ingredient.id, normalizeDecimal(ingredient.costPerUnit)])
        );

        await prisma.$transaction(async (tx) => {
            const updateResult = await tx.sale.updateMany({
                where: {
                    id: saleId,
                    storeId,
                    deletedAt: null,
                },
                data: {
                    status: SaleStatus.VOIDED,
                    voidedAt: new Date(),
                },
            });

            if (updateResult.count === 0) {
                throw new AppError('NOT_FOUND', 'Sale not found', 404);
            }

            if (movementDeltas.length) {
                await tx.inventoryMovement.createMany({
                    data: movementDeltas.map((delta) => ({
                        storeId,
                        itemType: delta.itemType,
                        itemId: delta.itemId,
                        qtyDelta: new Prisma.Decimal(delta.qtyDelta),
                        unitCost:
                            delta.itemType === ItemType.PRODUCT
                                ? productCostMap.get(delta.itemId) !== null
                                    ? new Prisma.Decimal(productCostMap.get(delta.itemId) ?? 0)
                                    : null
                                : new Prisma.Decimal(ingredientCostMap.get(delta.itemId) ?? 0),
                        type: MovementType.VOID,
                        referenceType: 'SALE_VOID',
                        referenceId: saleId,
                        createdById: userId,
                    })),
                });
            }
        });

        const updated = await saleRepository.getById(storeId, saleId);
        if (!updated) {
            throw new AppError('NOT_FOUND', 'Sale not found', 404);
        }

        return mapSaleDetail(updated);
    },

    importSales: async (
        storeId: string,
        importerId: string,
        rawRows: Array<{
            saleId: string;
            date: string;
            paymentMode: string;
            staff: string;
            seniorDiscount: number;
            productName: string;
            qty: number;
            unitPrice: number;
            lineTotal: number;
        }>
    ) => {
        const PAYMENT_MODE_MAP: Record<string, PaymentMethod> = {
            cash: PaymentMethod.CASH,
            card: PaymentMethod.CARD,
            'credit card': PaymentMethod.CARD,
            'debit card': PaymentMethod.CARD,
            gcash: PaymentMethod.GCASH,
            maya: PaymentMethod.MAYA,
            paymaya: PaymentMethod.MAYA,
            transfer: PaymentMethod.TRANSFER,
            'bank transfer': PaymentMethod.TRANSFER,
        };

        const storeProducts = await prisma.product.findMany({
            where: { storeId, deletedAt: null },
            select: { id: true, name: true },
        });
        const productByName = new Map(storeProducts.map((p) => [p.name.toLowerCase().trim(), p]));

        const storeMembers = await prisma.storeMember.findMany({
            where: { storeId },
            select: { userId: true, user: { select: { fullName: true, email: true } } },
        });
        const cashierByName = new Map(
            storeMembers.flatMap((m) => {
                const entries: [string, string][] = [];
                if (m.user.fullName) entries.push([m.user.fullName.toLowerCase().trim(), m.userId]);
                if (m.user.email) entries.push([m.user.email.toLowerCase().trim(), m.userId]);
                return entries;
            })
        );

        type ImportGroup = {
            date: Date;
            paymentMethod: PaymentMethod;
            cashierId: string;
            discount: number;
            items: { productId: string; name: string; qty: number; unitPrice: number; lineTotal: number }[];
        };

        const groups = new Map<string, ImportGroup>();
        const failedSaleIds = new Set<string>();
        const errors: Array<{ saleId: string; message: string }> = [];

        for (const row of rawRows) {
            const { saleId } = row;
            if (failedSaleIds.has(saleId)) continue;

            if (!row.productName) {
                failedSaleIds.add(saleId);
                groups.delete(saleId);
                errors.push({ saleId, message: 'Skipped: product name is blank in this row' });
                continue;
            }

            const product = productByName.get(row.productName.toLowerCase().trim());
            if (!product) {
                failedSaleIds.add(saleId);
                groups.delete(saleId);
                errors.push({ saleId, message: `Product not found in this store: "${row.productName}"` });
                continue;
            }

            if (!groups.has(saleId)) {
                const paymentMethod = PAYMENT_MODE_MAP[row.paymentMode.toLowerCase().trim()] ?? PaymentMethod.OTHER;
                const parsedDate = new Date(row.date);
                const cashierId = (row.staff ? cashierByName.get(row.staff.toLowerCase().trim()) : undefined) ?? importerId;
                groups.set(saleId, {
                    date: isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
                    paymentMethod,
                    cashierId,
                    discount: row.seniorDiscount ?? 0,
                    items: [],
                });
            }

            groups.get(saleId)!.items.push({
                productId: product.id,
                name: product.name,
                qty: row.qty,
                unitPrice: row.unitPrice,
                lineTotal: row.lineTotal,
            });
        }

        let imported = 0;

        const CHUNK_SIZE = 200;
        const groupEntries = Array.from(groups.entries());

        for (let i = 0; i < groupEntries.length; i += CHUNK_SIZE) {
            const chunk = groupEntries.slice(i, i + CHUNK_SIZE);

            try {
                await prisma.$transaction(async (tx) => {
                    const maxResult = await tx.sale.aggregate({
                        where: { storeId, deletedAt: null },
                        _max: { receiptNumber: true },
                    });
                    let nextReceipt = (maxResult._max.receiptNumber ?? 0) + 1;

                    const saleBatch: Prisma.SaleCreateManyInput[] = [];
                    const itemBatch: Prisma.SaleItemCreateManyInput[] = [];

                    for (const [, sale] of chunk) {
                        const id = randomUUID();
                        const subtotal = roundMoney(sale.items.reduce((sum, i) => sum + roundMoney(i.qty * i.unitPrice), 0));
                        const discount = roundMoney(sale.discount);
                        const total = roundMoney(subtotal - discount);

                        saleBatch.push({
                            id,
                            storeId,
                            cashierId: sale.cashierId,
                            status: SaleStatus.FINALIZED,
                            receiptNumber: nextReceipt++,
                            subtotal: new Prisma.Decimal(subtotal),
                            discount: new Prisma.Decimal(discount),
                            tax: new Prisma.Decimal(0),
                            total: new Prisma.Decimal(total),
                            paymentMethod: sale.paymentMethod,
                            createdAt: sale.date,
                            finalizedAt: sale.date,
                        });

                        for (const item of sale.items) {
                            itemBatch.push({
                                saleId: id,
                                productId: item.productId,
                                nameSnapshot: item.name,
                                qty: new Prisma.Decimal(item.qty),
                                unitPrice: new Prisma.Decimal(roundMoney(item.unitPrice)),
                                discount: new Prisma.Decimal(0),
                                tax: new Prisma.Decimal(0),
                                total: new Prisma.Decimal(roundMoney(item.lineTotal)),
                            });
                        }
                    }

                    await tx.sale.createMany({ data: saleBatch });
                    await tx.saleItem.createMany({ data: itemBatch });
                });

                imported += chunk.length;
            } catch (err: any) {
                for (const [extSaleId] of chunk) {
                    errors.push({ saleId: extSaleId, message: err.message ?? 'Chunk import failed' });
                }
            }
        }

        return { imported, failed: failedSaleIds.size + (groups.size - imported), errors };
    },
};
