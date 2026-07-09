import { ItemType, MovementType, Prisma, ProductType, StoreType } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';
import { parseImportDate } from '../../shared/datetime';
import { inventoryRepository, MovementFilters } from './inventory.repository';

type StockItem = {
    itemType: ItemType;
    itemId: string;
    name: string;
    sku?: string | null;
    category?: string | null;
    unit: string;
    currentQty: number;
    lowStockThreshold: number;
    active: boolean;
    subType: string;
};

const normalizeDecimal = (value: Prisma.Decimal | null | undefined) => Number(value ?? 0);

const ensureStore = async (storeId: string) => {
    const store = await prisma.store.findFirst({
        where: {
            id: storeId,
            deletedAt: null,
        },
        select: {
            id: true,
            allowNegativeStock: true,
            lowStockThreshold: true,
        },
    });

    if (!store) {
        throw new AppError('NOT_FOUND', 'Store not found', 404);
    }

    return store;
};

// Resolves an optional backdated transfer date (YYYY-MM-DD) to midnight in the
// source store's timezone, so catch-up transfers land on the intended day.
// Returns undefined when no date is given, letting createdAt default to now.
const resolveTransferDate = (transferDate: string | null | undefined, timezone: string): Date | undefined => {
    if (!transferDate) return undefined;
    const parsed = parseImportDate(transferDate, timezone || 'Asia/Manila');
    if (!parsed) {
        throw new AppError('INVALID_TRANSFER_DATE', 'Transfer date is invalid.', 400);
    }
    if (parsed.getTime() > Date.now()) {
        throw new AppError('INVALID_TRANSFER_DATE', 'Transfer date cannot be in the future.', 400);
    }
    return parsed;
};

const buildStockItems = async (
    storeId: string,
    itemType?: ItemType,
    itemId?: string
): Promise<StockItem[]> => {
    const store = await ensureStore(storeId);
    const defaultLowStock = normalizeDecimal(store.lowStockThreshold);

    const includeProducts = !itemType || itemType === ItemType.PRODUCT;
    const includeIngredients = !itemType || itemType === ItemType.INGREDIENT;

    const [productSums, ingredientSums, products, ingredients] = await Promise.all([
        includeProducts ? inventoryRepository.sumByItemType(storeId, ItemType.PRODUCT) : Promise.resolve([]),
        includeIngredients ? inventoryRepository.sumByItemType(storeId, ItemType.INGREDIENT) : Promise.resolve([]),
        includeProducts
            ? prisma.product.findMany({
                  where: {
                      storeId,
                      deletedAt: null,
                      type: ProductType.READY_MADE,
                      ...(itemId ? { id: itemId } : {}),
                  },
              })
            : Promise.resolve([]),
        includeIngredients
            ? prisma.ingredient.findMany({
                  where: {
                      storeId,
                      deletedAt: null,
                      ...(itemId ? { id: itemId } : {}),
                  },
              })
            : Promise.resolve([]),
    ]);

    const productMap = new Map(productSums.map((row) => [row.itemId, normalizeDecimal(row._sum.qtyDelta)]));
    const ingredientMap = new Map(ingredientSums.map((row) => [row.itemId, normalizeDecimal(row._sum.qtyDelta)]));

    const stockItems: StockItem[] = [];

    if (includeProducts) {
        for (const product of products) {
            stockItems.push({
                itemType: ItemType.PRODUCT,
                itemId: product.id,
                name: product.name,
                sku: product.sku,
                category: product.category,
                unit: product.unit,
                currentQty: productMap.get(product.id) ?? 0,
                lowStockThreshold: product.lowStockThreshold
                    ? normalizeDecimal(product.lowStockThreshold)
                    : defaultLowStock,
                active: product.active,
                subType: 'READY_MADE',
            });
        }
    }

    if (includeIngredients) {
        for (const ingredient of ingredients) {
            stockItems.push({
                itemType: ItemType.INGREDIENT,
                itemId: ingredient.id,
                name: ingredient.name,
                unit: ingredient.unit,
                currentQty: ingredientMap.get(ingredient.id) ?? 0,
                lowStockThreshold: ingredient.lowStockThreshold
                    ? normalizeDecimal(ingredient.lowStockThreshold)
                    : defaultLowStock,
                active: ingredient.active,
                subType: ingredient.category,
            });
        }
    }

    return stockItems;
};

const buildMovementResponse = async (
    storeId: string,
    movements: Prisma.InventoryMovementGetPayload<{
        include: { createdBy: { select: { id: true; fullName: true; email: true } } };
    }>[]
) => {
    const productIds = new Set<string>();
    const ingredientIds = new Set<string>();
    const counterpartStoreIds = new Set<string>();

    movements.forEach((movement) => {
        if (movement.itemType === ItemType.PRODUCT) {
            productIds.add(movement.itemId);
        } else {
            ingredientIds.add(movement.itemId);
        }
        if (movement.counterpartStoreId) {
            counterpartStoreIds.add(movement.counterpartStoreId);
        }
    });

    const [products, ingredients, counterpartStores] = await Promise.all([
        productIds.size
            ? prisma.product.findMany({
                  where: {
                      id: { in: Array.from(productIds) },
                      storeId,
                      deletedAt: null,
                  },
                  select: { id: true, name: true, sku: true, unit: true, category: true },
              })
            : Promise.resolve([]),
        ingredientIds.size
            ? prisma.ingredient.findMany({
                  where: {
                      id: { in: Array.from(ingredientIds) },
                      storeId,
                      deletedAt: null,
                  },
                  select: { id: true, name: true, unit: true },
              })
            : Promise.resolve([]),
        counterpartStoreIds.size
            ? prisma.store.findMany({
                  where: { id: { in: Array.from(counterpartStoreIds) } },
                  select: { id: true, name: true, storeType: true },
              })
            : Promise.resolve([]),
    ]);

    const productMap = new Map(products.map((product) => [product.id, product]));
    const ingredientMap = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
    const counterpartStoreMap = new Map(counterpartStores.map((s) => [s.id, s]));

    return movements.map((movement) => {
        const product = movement.itemType === ItemType.PRODUCT ? productMap.get(movement.itemId) : null;
        const ingredient = movement.itemType === ItemType.INGREDIENT ? ingredientMap.get(movement.itemId) : null;
        const counterpartStore = movement.counterpartStoreId
            ? counterpartStoreMap.get(movement.counterpartStoreId)
            : null;
        return {
            id: movement.id,
            itemType: movement.itemType,
            itemId: movement.itemId,
            itemName: product?.name ?? ingredient?.name ?? 'Unknown item',
            itemSku: product?.sku ?? null,
            itemUnit: product?.unit ?? ingredient?.unit ?? null,
            itemCategory: product?.category ?? null,
            qtyDelta: normalizeDecimal(movement.qtyDelta),
            unitCost: movement.unitCost ? normalizeDecimal(movement.unitCost) : null,
            type: movement.type,
            referenceType: movement.referenceType,
            referenceId: movement.referenceId,
            note: movement.note,
            createdAt: movement.createdAt,
            createdBy: movement.createdBy,
            counterpartStoreId: movement.counterpartStoreId ?? null,
            counterpartStoreName: counterpartStore?.name ?? null,
            counterpartStoreType: counterpartStore?.storeType ?? null,
            counterpartMovementId: movement.counterpartMovementId ?? null,
        };
    });
};

// Resolve the destination-store ingredient that a transfer should land on,
// creating a matching copy from the source ingredient when none exists.
// Ingredient name is unique per store (@@unique([storeId, name])), so we match
// by name and revive a soft-deleted match rather than hitting that constraint.
const findOrCreateDestinationIngredientId = async (
    tx: Prisma.TransactionClient,
    destStoreId: string,
    source: Prisma.IngredientGetPayload<{}>
): Promise<string> => {
    const existing = await tx.ingredient.findFirst({
        where: { storeId: destStoreId, name: source.name },
        select: { id: true, deletedAt: true },
    });
    if (existing) {
        if (existing.deletedAt) {
            await tx.ingredient.update({
                where: { id: existing.id },
                data: { deletedAt: null, active: true },
            });
        }
        return existing.id;
    }
    const created = await tx.ingredient.create({
        data: {
            store: { connect: { id: destStoreId } },
            name: source.name,
            unit: source.unit,
            category: source.category,
            costPerUnit: source.costPerUnit,
            purchaseUnit: source.purchaseUnit,
            purchaseUnitSize: source.purchaseUnitSize,
            lowStockThreshold: source.lowStockThreshold,
        },
        select: { id: true },
    });
    return created.id;
};

// Resolve the destination-store product for a transfer. Products have no unique
// name, so match an active READY_MADE product by name; otherwise create one.
// sku/barcode are left null to avoid the per-store unique constraints colliding
// with unrelated destination products.
const findOrCreateDestinationProductId = async (
    tx: Prisma.TransactionClient,
    destStoreId: string,
    source: Prisma.ProductGetPayload<{}>
): Promise<string> => {
    const existing = await tx.product.findFirst({
        where: {
            storeId: destStoreId,
            name: source.name,
            type: ProductType.READY_MADE,
            deletedAt: null,
        },
        select: { id: true },
    });
    if (existing) return existing.id;
    const created = await tx.product.create({
        data: {
            store: { connect: { id: destStoreId } },
            name: source.name,
            type: ProductType.READY_MADE,
            price: source.price,
            cost: source.cost,
            unit: source.unit,
            category: source.category,
            lowStockThreshold: source.lowStockThreshold,
        },
        select: { id: true },
    });
    return created.id;
};

export const inventoryService = {
    getStock: async (storeId: string, itemType?: ItemType, itemId?: string) => {
        return buildStockItems(storeId, itemType, itemId);
    },
    listMovements: async (
        storeId: string,
        filters: Omit<MovementFilters, 'storeId'>,
        page: number,
        pageSize: number
    ) => {
        const skip = (page - 1) * pageSize;
        const movementFilters: MovementFilters = {
            storeId,
            ...filters,
        };

        const [total, movements] = await Promise.all([
            inventoryRepository.countMovements(movementFilters),
            inventoryRepository.listMovements(movementFilters, skip, pageSize),
        ]);

        const formatted = await buildMovementResponse(storeId, movements);

        return {
            movements: formatted,
            total,
            page,
            pageSize,
        };
    },
    createAdjustment: async (
        storeId: string,
        userId: string | undefined,
        data: {
            itemType: ItemType;
            itemId: string;
            adjustmentMode?: 'DELTA' | 'SET';
            qtyDelta?: number;
            targetQty?: number;
            unitCost?: number | null;
            note?: string | null;
        }
    ) => {
        if (!userId) {
            throw new AppError('UNAUTHORIZED', 'User is required to record adjustments.', 401);
        }
        const store = await ensureStore(storeId);

        let itemName = '';
        if (data.itemType === ItemType.PRODUCT) {
            const product = await prisma.product.findFirst({
                where: {
                    id: data.itemId,
                    storeId,
                    deletedAt: null,
                },
                select: { type: true, name: true },
            });
            if (!product) {
                throw new AppError('NOT_FOUND', 'Product not found', 404);
            }
            if (product.type !== ProductType.READY_MADE) {
                throw new AppError(
                    'INVALID_PRODUCT_TYPE',
                    'Recipe products cannot be adjusted directly.',
                    400
                );
            }
            itemName = product.name;
        } else {
            const ingredient = await prisma.ingredient.findFirst({
                where: {
                    id: data.itemId,
                    storeId,
                    deletedAt: null,
                },
                select: { id: true, name: true },
            });
            if (!ingredient) {
                throw new AppError('NOT_FOUND', 'Ingredient not found', 404);
            }
            itemName = ingredient.name;
        }

        const currentQty = normalizeDecimal(
            await inventoryRepository.sumByItemId(storeId, data.itemType, data.itemId)
        );
        const adjustmentMode =
            data.adjustmentMode ?? (data.targetQty !== undefined && data.targetQty !== null ? 'SET' : 'DELTA');
        const resolvedDelta =
            adjustmentMode === 'SET'
                ? data.targetQty !== undefined && data.targetQty !== null
                    ? data.targetQty - currentQty
                    : null
                : data.qtyDelta ?? null;

        if (resolvedDelta === null || resolvedDelta === undefined) {
            throw new AppError('INVALID_ADJUSTMENT', 'Adjustment payload is incomplete.', 400);
        }

        if (resolvedDelta === 0) {
            throw new AppError('NO_CHANGE', 'Adjustment must change stock quantity.', 400);
        }

        const nextQty = currentQty + resolvedDelta;
        if (!store.allowNegativeStock && nextQty < 0) {
            throw new AppError('NEGATIVE_STOCK', 'Stock adjustment would result in negative inventory.', 400);
        }

        const movement = await prisma.$transaction(async (tx) => {
            const createdMovement = await tx.inventoryMovement.create({
                data: {
                    store: { connect: { id: storeId } },
                    itemType: data.itemType,
                    itemId: data.itemId,
                    qtyDelta: new Prisma.Decimal(resolvedDelta),
                    unitCost:
                        data.unitCost !== undefined && data.unitCost !== null
                            ? new Prisma.Decimal(data.unitCost)
                            : null,
                    type: MovementType.STOCK_ADJUSTMENT,
                    note: data.note ?? null,
                    createdBy: { connect: { id: userId } },
                },
                include: {
                    createdBy: {
                        select: {
                            id: true,
                            fullName: true,
                            email: true,
                        },
                    },
                },
            });

            await tx.auditLog.create({
                data: {
                    store: { connect: { id: storeId } },
                    actor: { connect: { id: userId } },
                    action: 'INVENTORY_ADJUSTMENT',
                    entityType: 'InventoryMovement',
                    entityId: createdMovement.id,
                    meta: {
                        itemType: data.itemType,
                        itemId: data.itemId,
                        itemName,
                        adjustmentMode,
                        qtyDelta: resolvedDelta,
                        targetQty: adjustmentMode === 'SET' ? data.targetQty ?? null : null,
                        unitCost: data.unitCost ?? null,
                        note: data.note ?? null,
                        currentQty,
                        nextQty,
                    },
                },
            });

            return createdMovement;
        });

        return buildMovementResponse(storeId, [movement]).then((items) => items[0]);
    },
    transferStock: async (
        sourceStoreId: string,
        userId: string | undefined,
        data: {
            destinationStoreId: string;
            itemType: ItemType;
            itemId: string;
            qty: number;
            note?: string | null;
            transferDate?: string | null;
        }
    ) => {
        if (!userId) {
            throw new AppError('UNAUTHORIZED', 'User is required to record transfers.', 401);
        }
        if (data.destinationStoreId === sourceStoreId) {
            throw new AppError('INVALID_TRANSFER', 'Source and destination must be different stores.', 400);
        }

        const [sourceStore, destStore] = await Promise.all([
            prisma.store.findFirst({
                where: { id: sourceStoreId, deletedAt: null },
                select: { id: true, name: true, allowNegativeStock: true, storeType: true, timezone: true },
            }),
            prisma.store.findFirst({
                where: { id: data.destinationStoreId, deletedAt: null },
                select: { id: true, name: true, storeType: true },
            }),
        ]);

        if (!sourceStore) throw new AppError('NOT_FOUND', 'Source store not found', 404);
        if (!destStore) throw new AppError('NOT_FOUND', 'Destination store not found', 404);

        const movementDate = resolveTransferDate(data.transferDate, sourceStore.timezone);

        let itemName = '';
        let sourceProduct: Prisma.ProductGetPayload<{}> | null = null;
        let sourceIngredient: Prisma.IngredientGetPayload<{}> | null = null;
        if (data.itemType === ItemType.PRODUCT) {
            sourceProduct = await prisma.product.findFirst({
                where: { id: data.itemId, storeId: sourceStoreId, deletedAt: null },
            });
            if (!sourceProduct) throw new AppError('NOT_FOUND', 'Product not found', 404);
            if (sourceProduct.type !== ProductType.READY_MADE) {
                throw new AppError('INVALID_PRODUCT_TYPE', 'Recipe products cannot be transferred directly.', 400);
            }
            itemName = sourceProduct.name;
        } else {
            sourceIngredient = await prisma.ingredient.findFirst({
                where: { id: data.itemId, storeId: sourceStoreId, deletedAt: null },
            });
            if (!sourceIngredient) throw new AppError('NOT_FOUND', 'Ingredient not found', 404);
            itemName = sourceIngredient.name;
        }

        const currentQty = normalizeDecimal(
            await inventoryRepository.sumByItemId(sourceStoreId, data.itemType, data.itemId)
        );

        if (!sourceStore.allowNegativeStock && currentQty - data.qty < 0) {
            throw new AppError(
                'NEGATIVE_STOCK',
                `Insufficient stock. Available: ${currentQty} — requested: ${data.qty}`,
                400
            );
        }

        const [outMovement, inMovement] = await prisma.$transaction(async (tx) => {
            const outMov = await tx.inventoryMovement.create({
                data: {
                    store: { connect: { id: sourceStoreId } },
                    itemType: data.itemType,
                    itemId: data.itemId,
                    qtyDelta: new Prisma.Decimal(-data.qty),
                    type: MovementType.TRANSFER_OUT,
                    counterpartStoreId: data.destinationStoreId,
                    note: data.note ?? null,
                    createdBy: { connect: { id: userId } },
                    ...(movementDate ? { createdAt: movementDate } : {}),
                },
                include: { createdBy: { select: { id: true, fullName: true, email: true } } },
            });

            // The destination store keeps its own item catalog, so land the
            // incoming stock on a matching destination item (created if needed)
            // rather than the source store's item id.
            const destItemId =
                data.itemType === ItemType.PRODUCT
                    ? await findOrCreateDestinationProductId(tx, data.destinationStoreId, sourceProduct!)
                    : await findOrCreateDestinationIngredientId(tx, data.destinationStoreId, sourceIngredient!);

            const inMov = await tx.inventoryMovement.create({
                data: {
                    store: { connect: { id: data.destinationStoreId } },
                    itemType: data.itemType,
                    itemId: destItemId,
                    qtyDelta: new Prisma.Decimal(data.qty),
                    type: MovementType.TRANSFER_IN,
                    counterpartStoreId: sourceStoreId,
                    counterpartMovementId: outMov.id,
                    note: data.note ?? null,
                    createdBy: { connect: { id: userId } },
                    ...(movementDate ? { createdAt: movementDate } : {}),
                },
                include: { createdBy: { select: { id: true, fullName: true, email: true } } },
            });

            await tx.inventoryMovement.update({
                where: { id: outMov.id },
                data: { counterpartMovementId: inMov.id },
            });

            await tx.auditLog.create({
                data: {
                    store: { connect: { id: sourceStoreId } },
                    actor: { connect: { id: userId } },
                    action: 'INVENTORY_TRANSFER',
                    entityType: 'InventoryMovement',
                    entityId: outMov.id,
                    meta: {
                        itemType: data.itemType,
                        itemId: data.itemId,
                        destinationItemId: destItemId,
                        itemName,
                        qty: data.qty,
                        destinationStoreId: data.destinationStoreId,
                        destinationStoreName: destStore.name,
                        note: data.note ?? null,
                        transferDate: data.transferDate ?? null,
                        currentQty,
                        nextQty: currentQty - data.qty,
                    },
                },
            });

            return [outMov, inMov];
        });

        const [formattedOut] = await buildMovementResponse(sourceStoreId, [outMovement]);
        return {
            out: formattedOut,
            inMovementId: inMovement.id,
            destinationStoreName: destStore.name,
        };
    },
    batchTransferStock: async (
        sourceStoreId: string,
        userId: string | undefined,
        data: {
            destinationStoreId: string;
            items: Array<{ itemType: ItemType; itemId: string; qty: number }>;
            note?: string | null;
            transferDate?: string | null;
        }
    ) => {
        if (!userId) {
            throw new AppError('UNAUTHORIZED', 'User is required to record transfers.', 401);
        }
        if (data.destinationStoreId === sourceStoreId) {
            throw new AppError('INVALID_TRANSFER', 'Source and destination must be different stores.', 400);
        }

        const [sourceStore, destStore] = await Promise.all([
            prisma.store.findFirst({
                where: { id: sourceStoreId, deletedAt: null },
                select: { id: true, name: true, allowNegativeStock: true, storeType: true, timezone: true },
            }),
            prisma.store.findFirst({
                where: { id: data.destinationStoreId, deletedAt: null },
                select: { id: true, name: true, storeType: true },
            }),
        ]);

        if (!sourceStore) throw new AppError('NOT_FOUND', 'Source store not found', 404);
        if (!destStore) throw new AppError('NOT_FOUND', 'Destination store not found', 404);

        const movementDate = resolveTransferDate(data.transferDate, sourceStore.timezone);

        // Validate all items and fetch their names + current quantities
        const itemDetails: Array<{
            itemType: ItemType;
            itemId: string;
            itemName: string;
            qty: number;
            currentQty: number;
            sourceProduct: Prisma.ProductGetPayload<{}> | null;
            sourceIngredient: Prisma.IngredientGetPayload<{}> | null;
        }> = [];

        for (const item of data.items) {
            let itemName = '';
            let sourceProduct: Prisma.ProductGetPayload<{}> | null = null;
            let sourceIngredient: Prisma.IngredientGetPayload<{}> | null = null;
            if (item.itemType === ItemType.PRODUCT) {
                sourceProduct = await prisma.product.findFirst({
                    where: { id: item.itemId, storeId: sourceStoreId, deletedAt: null },
                });
                if (!sourceProduct) throw new AppError('NOT_FOUND', `Product ${item.itemId} not found`, 404);
                if (sourceProduct.type !== ProductType.READY_MADE) {
                    throw new AppError('INVALID_PRODUCT_TYPE', `"${sourceProduct.name}" is a recipe product and cannot be transferred directly.`, 400);
                }
                itemName = sourceProduct.name;
            } else {
                sourceIngredient = await prisma.ingredient.findFirst({
                    where: { id: item.itemId, storeId: sourceStoreId, deletedAt: null },
                });
                if (!sourceIngredient) throw new AppError('NOT_FOUND', `Ingredient ${item.itemId} not found`, 404);
                itemName = sourceIngredient.name;
            }

            const currentQty = normalizeDecimal(
                await inventoryRepository.sumByItemId(sourceStoreId, item.itemType, item.itemId)
            );

            if (!sourceStore.allowNegativeStock && currentQty - item.qty < 0) {
                throw new AppError(
                    'NEGATIVE_STOCK',
                    `Insufficient stock for "${itemName}". Available: ${currentQty} — requested: ${item.qty}`,
                    400
                );
            }

            itemDetails.push({ ...item, itemName, currentQty, sourceProduct, sourceIngredient });
        }

        const outMovements = await prisma.$transaction(async (tx) => {
            const created: Prisma.InventoryMovementGetPayload<{
                include: { createdBy: { select: { id: true; fullName: true; email: true } } };
            }>[] = [];

            for (const item of itemDetails) {
                const outMov = await tx.inventoryMovement.create({
                    data: {
                        store: { connect: { id: sourceStoreId } },
                        itemType: item.itemType,
                        itemId: item.itemId,
                        qtyDelta: new Prisma.Decimal(-item.qty),
                        type: MovementType.TRANSFER_OUT,
                        counterpartStoreId: data.destinationStoreId,
                        note: data.note ?? null,
                        createdBy: { connect: { id: userId } },
                        ...(movementDate ? { createdAt: movementDate } : {}),
                    },
                    include: { createdBy: { select: { id: true, fullName: true, email: true } } },
                });

                // Land incoming stock on a matching destination-store item
                // (created if needed) instead of the source store's item id.
                const destItemId =
                    item.itemType === ItemType.PRODUCT
                        ? await findOrCreateDestinationProductId(tx, data.destinationStoreId, item.sourceProduct!)
                        : await findOrCreateDestinationIngredientId(tx, data.destinationStoreId, item.sourceIngredient!);

                const inMov = await tx.inventoryMovement.create({
                    data: {
                        store: { connect: { id: data.destinationStoreId } },
                        itemType: item.itemType,
                        itemId: destItemId,
                        qtyDelta: new Prisma.Decimal(item.qty),
                        type: MovementType.TRANSFER_IN,
                        counterpartStoreId: sourceStoreId,
                        counterpartMovementId: outMov.id,
                        note: data.note ?? null,
                        createdBy: { connect: { id: userId } },
                        ...(movementDate ? { createdAt: movementDate } : {}),
                    },
                    include: { createdBy: { select: { id: true, fullName: true, email: true } } },
                });

                await tx.inventoryMovement.update({
                    where: { id: outMov.id },
                    data: { counterpartMovementId: inMov.id },
                });

                created.push(outMov);
            }

            await tx.auditLog.create({
                data: {
                    store: { connect: { id: sourceStoreId } },
                    actor: { connect: { id: userId } },
                    action: 'INVENTORY_TRANSFER',
                    entityType: 'InventoryMovement',
                    entityId: created[0].id,
                    meta: {
                        batchSize: itemDetails.length,
                        destinationStoreId: data.destinationStoreId,
                        destinationStoreName: destStore.name,
                        note: data.note ?? null,
                        transferDate: data.transferDate ?? null,
                        items: itemDetails.map((i) => ({
                            itemType: i.itemType,
                            itemId: i.itemId,
                            itemName: i.itemName,
                            qty: i.qty,
                            currentQty: i.currentQty,
                        })),
                    },
                },
            });

            return created;
        });

        const formatted = await buildMovementResponse(sourceStoreId, outMovements);
        return {
            transferred: formatted.length,
            destinationStoreName: destStore.name,
            movements: formatted,
        };
    },
};
