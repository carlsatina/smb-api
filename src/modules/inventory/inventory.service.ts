import { ItemType, MovementType, Prisma, ProductType } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';
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

    movements.forEach((movement) => {
        if (movement.itemType === ItemType.PRODUCT) {
            productIds.add(movement.itemId);
        } else {
            ingredientIds.add(movement.itemId);
        }
    });

    const [products, ingredients] = await Promise.all([
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
    ]);

    const productMap = new Map(products.map((product) => [product.id, product]));
    const ingredientMap = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));

    return movements.map((movement) => {
        const product = movement.itemType === ItemType.PRODUCT ? productMap.get(movement.itemId) : null;
        const ingredient = movement.itemType === ItemType.INGREDIENT ? ingredientMap.get(movement.itemId) : null;
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
        };
    });
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
};
