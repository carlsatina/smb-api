import { ItemType, MovementType, Prisma, ProductType, PurchaseOrderStatus } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';
import { purchaseOrderRepository } from './purchaseOrder.repository';

type PurchaseOrderItemInput = {
    itemType: ItemType;
    itemId: string;
    qtyOrdered: number;
    unitCost?: number;
};

type ReceiveItemInput = {
    itemType: ItemType;
    itemId: string;
    qtyReceived: number;
    unitCost?: number;
};

type SupplierSummaryRow = {
    supplierId: string | null;
    supplier: string | null;
    total: Prisma.Decimal | number | string | null;
    receipts: bigint | number | string;
};

type CategorySummaryRow = {
    category: string | null;
    total: Prisma.Decimal | number | string | null;
    qty: Prisma.Decimal | number | string | null;
};

const normalizeDecimal = (value: Prisma.Decimal | null | undefined) => Number(value ?? 0);
const normalizeNumber = (value: Prisma.Decimal | number | string | bigint | null | undefined) =>
    Number(value ?? 0);
const roundMoney = (value: number) => Number(value.toFixed(2));
const roundQty = (value: number) => Number(value.toFixed(4));

const mapSummary = (
    purchaseOrder: Prisma.PurchaseOrderGetPayload<{
        include: {
            supplier: { select: { id: true; name: true } };
            items: { select: { qtyOrdered: true; qtyReceived: true } };
            receipts: { select: { invoiceNumber: true } };
        };
    }>
) => {
    const qtyOrdered = purchaseOrder.items.reduce((sum, item) => sum + normalizeDecimal(item.qtyOrdered), 0);
    const qtyReceived = purchaseOrder.items.reduce((sum, item) => sum + normalizeDecimal(item.qtyReceived), 0);
    const latestInvoice = purchaseOrder.receipts?.[0]?.invoiceNumber ?? null;

    return {
        id: purchaseOrder.id,
        supplierName: purchaseOrder.supplier?.name ?? purchaseOrder.supplierName ?? null,
        supplierId: purchaseOrder.supplierId,
        status: purchaseOrder.status,
        expectedDate: purchaseOrder.expectedDate,
        createdAt: purchaseOrder.createdAt,
        updatedAt: purchaseOrder.updatedAt,
        itemCount: purchaseOrder.items.length,
        qtyOrdered,
        qtyReceived,
        latestInvoiceNumber: latestInvoice,
    };
};

const mapDetail = (
    purchaseOrder: Prisma.PurchaseOrderGetPayload<{
        include: {
            supplier: { select: { id: true; name: true } };
            items: {
                include: {
                    product: { select: { id: true, name: true, sku: true, unit: true, type: true } };
                    ingredient: { select: { id: true, name: true, unit: true } };
                };
            };
            receipts: {
                select: { id: true; invoiceNumber: true; receivedAt: true; totalCost: true };
            };
        };
    }>
) => {
    const items = purchaseOrder.items.map((item) => {
        const qtyOrdered = normalizeDecimal(item.qtyOrdered);
        const qtyReceived = normalizeDecimal(item.qtyReceived);
        const itemId = item.itemType === ItemType.PRODUCT ? item.productId : item.ingredientId;
        return {
            id: item.id,
            itemType: item.itemType,
            itemId: itemId ?? '',
            product: item.product,
            ingredient: item.ingredient,
            qtyOrdered,
            qtyReceived,
            qtyRemaining: Math.max(qtyOrdered - qtyReceived, 0),
            unitCost: normalizeDecimal(item.unitCost),
        };
    });

    const receipts = purchaseOrder.receipts.map((receipt) => ({
        id: receipt.id,
        invoiceNumber: receipt.invoiceNumber,
        receivedAt: receipt.receivedAt,
        totalCost: normalizeDecimal(receipt.totalCost),
    }));

    return {
        id: purchaseOrder.id,
        supplierName: purchaseOrder.supplier?.name ?? purchaseOrder.supplierName ?? null,
        supplierId: purchaseOrder.supplierId,
        status: purchaseOrder.status,
        expectedDate: purchaseOrder.expectedDate,
        createdAt: purchaseOrder.createdAt,
        updatedAt: purchaseOrder.updatedAt,
        items,
        receipts,
    };
};

const mapReceipt = (
    receipt: Prisma.PurchaseReceiptGetPayload<{
        include: {
            purchaseOrder: {
                select: {
                    id: true;
                    supplierId: true;
                    supplierName: true;
                    supplier: { select: { id: true; name: true } };
                };
            };
            receivedBy: { select: { id: true; fullName: true; email: true } };
            items: {
                include: {
                    product: { select: { id: true; name: true; sku: true; unit: true } };
                    ingredient: { select: { id: true; name: true; unit: true } };
                };
            };
        };
    }>
) => {
    return {
        id: receipt.id,
        purchaseOrderId: receipt.purchaseOrderId,
        supplierId: receipt.purchaseOrder?.supplier?.id ?? receipt.purchaseOrder?.supplierId ?? null,
        supplierName: receipt.purchaseOrder?.supplier?.name ?? receipt.purchaseOrder?.supplierName ?? null,
        invoiceNumber: receipt.invoiceNumber,
        receivedAt: receipt.receivedAt,
        totalCost: normalizeDecimal(receipt.totalCost),
        receivedBy: receipt.receivedBy,
        items: receipt.items.map((item) => {
            const itemId = item.itemType === ItemType.PRODUCT ? item.productId : item.ingredientId;
            const name =
                item.itemType === ItemType.PRODUCT ? item.product?.name : item.ingredient?.name;
            const unit =
                item.itemType === ItemType.PRODUCT ? item.product?.unit : item.ingredient?.unit;
            return {
                id: item.id,
                itemType: item.itemType,
                itemId: itemId ?? '',
                name: name ?? 'Unknown item',
                unit: unit ?? null,
                qtyReceived: normalizeDecimal(item.qtyReceived),
                unitCost: normalizeDecimal(item.unitCost),
            };
        }),
    };
};

const buildReceiptWhere = (
    storeId: string,
    from?: Date,
    to?: Date,
    supplierId?: string | null,
    supplierName?: string
): Prisma.PurchaseReceiptWhereInput => {
    const where: Prisma.PurchaseReceiptWhereInput = {
        storeId,
        ...(from || to
            ? {
                  receivedAt: {
                      ...(from ? { gte: from } : {}),
                      ...(to ? { lte: to } : {}),
                  },
              }
            : {}),
    };

    if (supplierId !== undefined) {
        if (supplierId === null) {
            where.OR = [
                { purchaseOrderId: null },
                { purchaseOrder: { supplierId: null } },
            ];
        } else {
            where.purchaseOrder = { supplierId };
        }
        return where;
    }

    if (supplierName) {
        where.OR = [
            { purchaseOrder: { supplier: { name: { contains: supplierName, mode: 'insensitive' } } } },
            { purchaseOrder: { supplierName: { contains: supplierName, mode: 'insensitive' } } },
        ];
    }

    return where;
};

const buildSupplierFilterSql = (supplierId?: string | null, supplierName?: string) => {
    if (supplierId !== undefined) {
        if (supplierId === null) {
            return Prisma.sql`AND (pr."purchaseOrderId" IS NULL OR po."supplierId" IS NULL)`;
        }
        return Prisma.sql`AND po."supplierId" = ${supplierId}`;
    }

    if (supplierName) {
        const pattern = `%${supplierName}%`;
        return Prisma.sql`AND (s."name" ILIKE ${pattern} OR po."supplierName" ILIKE ${pattern})`;
    }

    return Prisma.sql``;
};

const ensureSupplier = async (storeId: string, supplierId?: string, supplierName?: string) => {
    if (!supplierId) {
        return {
            supplierId: null,
            supplierName: supplierName ?? null,
        };
    }

    const supplier = await prisma.supplier.findFirst({
        where: {
            id: supplierId,
            storeId,
            deletedAt: null,
        },
    });

    if (!supplier) {
        throw new AppError('SUPPLIER_NOT_FOUND', 'Supplier not found', 404);
    }

    return {
        supplierId: supplier.id,
        supplierName: supplierName ?? supplier.name,
    };
};

const buildItemKey = (itemType: ItemType, itemId: string) => `${itemType}:${itemId}`;

const validateItems = async (storeId: string, items: { itemType: ItemType; itemId: string }[]) => {
    const keys = items.map((item) => buildItemKey(item.itemType, item.itemId));
    const uniqueKeys = new Set(keys);

    if (uniqueKeys.size !== keys.length) {
        throw new AppError('DUPLICATE_ITEM', 'Each item can only appear once.', 400);
    }

    const productIds = items.filter((item) => item.itemType === ItemType.PRODUCT).map((item) => item.itemId);
    const ingredientIds = items.filter((item) => item.itemType === ItemType.INGREDIENT).map((item) => item.itemId);

    if (productIds.length) {
        const products = await prisma.product.findMany({
            where: {
                storeId,
                deletedAt: null,
                id: { in: productIds },
            },
            select: {
                id: true,
                type: true,
            },
        });

        if (products.length !== new Set(productIds).size) {
            throw new AppError('PRODUCT_NOT_FOUND', 'One or more products are missing.', 404);
        }

        const nonReadyMade = products.find((product) => product.type !== ProductType.READY_MADE);
        if (nonReadyMade) {
            throw new AppError('INVALID_PRODUCT_TYPE', 'Only ready-made products can be ordered.', 400);
        }
    }

    if (ingredientIds.length) {
        const ingredients = await prisma.ingredient.findMany({
            where: {
                storeId,
                deletedAt: null,
                id: { in: ingredientIds },
            },
            select: { id: true },
        });

        if (ingredients.length !== new Set(ingredientIds).size) {
            throw new AppError('INGREDIENT_NOT_FOUND', 'One or more ingredients are missing.', 404);
        }
    }
};

const ensureStatusUpdatable = (status: PurchaseOrderStatus) => {
    if (status === PurchaseOrderStatus.RECEIVED || status === PurchaseOrderStatus.CANCELLED) {
        throw new AppError('INVALID_STATUS', 'Completed or cancelled purchase orders cannot be edited.', 400);
    }
};

const ensureStatusAllowed = (status?: PurchaseOrderStatus) => {
    if (!status) return;
    const allowed: PurchaseOrderStatus[] = [
        PurchaseOrderStatus.DRAFT,
        PurchaseOrderStatus.SENT,
        PurchaseOrderStatus.CANCELLED,
    ];
    if (!allowed.includes(status)) {
        throw new AppError('INVALID_STATUS', 'Invalid purchase order status.', 400);
    }
};

const ensureStatusTransition = (current: PurchaseOrderStatus, next: PurchaseOrderStatus) => {
    if (current === next) return;
    const allowed: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
        [PurchaseOrderStatus.DRAFT]: [PurchaseOrderStatus.SENT, PurchaseOrderStatus.CANCELLED],
        [PurchaseOrderStatus.SENT]: [PurchaseOrderStatus.CANCELLED],
        [PurchaseOrderStatus.PARTIALLY_RECEIVED]: [],
        [PurchaseOrderStatus.RECEIVED]: [],
        [PurchaseOrderStatus.CANCELLED]: [],
    };

    if (!allowed[current]?.includes(next)) {
        throw new AppError('INVALID_STATUS', 'Invalid purchase order status transition.', 400);
    }
};

export const purchaseOrderService = {
    list: async (
        storeId: string,
        filters: {
            status?: PurchaseOrderStatus;
            search?: string;
            from?: Date;
            to?: Date;
            supplierId?: string;
            supplierName?: string;
        },
        page: number,
        pageSize: number
    ) => {
        const skip = (page - 1) * pageSize;
        const resolvedSupplierId = filters.supplierId === 'UNASSIGNED' ? null : filters.supplierId;
        const purchaseOrderFilters = {
            storeId,
            status: filters.status,
            search: filters.search,
            from: filters.from,
            to: filters.to,
            supplierId: resolvedSupplierId,
            supplierName: resolvedSupplierId !== undefined ? undefined : filters.supplierName,
        };
        const [total, purchaseOrders, statusCounts] = await Promise.all([
            purchaseOrderRepository.count(purchaseOrderFilters),
            purchaseOrderRepository.list(purchaseOrderFilters, skip, pageSize),
            purchaseOrderRepository.countByStatus(purchaseOrderFilters),
        ]);

        const statusCountMap = new Map(
            statusCounts.map((row) => [row.status, Number(row._count._all)])
        );
        const receivedCount = statusCountMap.get(PurchaseOrderStatus.RECEIVED) ?? 0;
        const cancelledCount = statusCountMap.get(PurchaseOrderStatus.CANCELLED) ?? 0;
        const openCount = Math.max(total - receivedCount - cancelledCount, 0);

        return {
            purchaseOrders: purchaseOrders.map(mapSummary),
            total,
            page,
            pageSize,
            summary: {
                openCount,
                receivedCount,
                totalCount: total,
            },
        };
    },
    get: async (storeId: string, purchaseOrderId: string) => {
        const purchaseOrder = await purchaseOrderRepository.getById(storeId, purchaseOrderId);
        if (!purchaseOrder) {
            throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
        }
        return mapDetail(purchaseOrder);
    },
    getReceipt: async (storeId: string, receiptId: string) => {
        const receipt = await prisma.purchaseReceipt.findFirst({
            where: {
                id: receiptId,
                storeId,
            },
            include: {
                purchaseOrder: {
                    select: {
                        id: true,
                        supplierId: true,
                        supplierName: true,
                        supplier: { select: { id: true, name: true } },
                    },
                },
                receivedBy: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                    },
                },
                items: {
                    include: {
                        product: { select: { id: true, name: true, sku: true, unit: true } },
                        ingredient: { select: { id: true, name: true, unit: true } },
                    },
                },
            },
        });

        if (!receipt) {
            throw new AppError('NOT_FOUND', 'Purchase receipt not found', 404);
        }

        return mapReceipt(receipt);
    },
    listReceipts: async (
        storeId: string,
        filters: { search?: string; from?: Date; to?: Date; supplierId?: string; supplierName?: string },
        page: number,
        pageSize: number
    ) => {
        const skip = (page - 1) * pageSize;
        const resolvedSupplierId = filters.supplierId === 'UNASSIGNED' ? null : filters.supplierId;
        const resolvedSupplierName = resolvedSupplierId !== undefined ? undefined : filters.supplierName;
        const where = buildReceiptWhere(storeId, filters.from, filters.to, resolvedSupplierId, resolvedSupplierName);
        const search = filters.search?.trim();

        if (search) {
            const searchFilter: Prisma.PurchaseReceiptWhereInput = {
                OR: [
                    { id: { contains: search, mode: 'insensitive' } },
                    { invoiceNumber: { contains: search, mode: 'insensitive' } },
                    { purchaseOrderId: { contains: search, mode: 'insensitive' } },
                    { purchaseOrder: { supplier: { name: { contains: search, mode: 'insensitive' } } } },
                    { purchaseOrder: { supplierName: { contains: search, mode: 'insensitive' } } },
                ],
            };
            const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
            where.AND = [...existingAnd, searchFilter];
        }

        const [total, receipts] = await Promise.all([
            prisma.purchaseReceipt.count({ where }),
            prisma.purchaseReceipt.findMany({
                where,
                orderBy: { receivedAt: 'desc' },
                skip,
                take: pageSize,
                include: {
                    purchaseOrder: {
                        select: {
                            id: true,
                            supplierName: true,
                            supplier: { select: { id: true, name: true } },
                        },
                    },
                    receivedBy: {
                        select: {
                            id: true,
                            fullName: true,
                            email: true,
                        },
                    },
                },
            }),
        ]);

        return {
            receipts: receipts.map((receipt) => ({
                id: receipt.id,
                purchaseOrderId: receipt.purchaseOrderId,
                supplierName: receipt.purchaseOrder?.supplier?.name ?? receipt.purchaseOrder?.supplierName ?? null,
                invoiceNumber: receipt.invoiceNumber,
                receivedAt: receipt.receivedAt,
                totalCost: normalizeDecimal(receipt.totalCost),
                receivedBy: receipt.receivedBy,
            })),
            total,
            page,
            pageSize,
        };
    },
    getReceiptSummary: async (
        storeId: string,
        filters: { from?: Date; to?: Date; supplierId?: string; supplierName?: string }
    ) => {
        const resolvedSupplierId = filters.supplierId === 'UNASSIGNED' ? null : filters.supplierId;
        const resolvedSupplierName = resolvedSupplierId !== undefined ? undefined : filters.supplierName;
        const where = buildReceiptWhere(storeId, filters.from, filters.to, resolvedSupplierId, resolvedSupplierName);
        const supplierFilterSql = buildSupplierFilterSql(resolvedSupplierId, resolvedSupplierName);

        const [totals, supplierRows, categoryRows] = await Promise.all([
            prisma.purchaseReceipt.aggregate({
                where,
                _sum: { totalCost: true },
                _count: { _all: true },
            }),
            prisma.$queryRaw<SupplierSummaryRow[]>`
                SELECT s."id" AS "supplierId",
                       COALESCE(s."name", po."supplierName", 'Unassigned') AS supplier,
                       SUM(pr."totalCost") AS total,
                       COUNT(*) AS receipts
                FROM "PurchaseReceipt" pr
                LEFT JOIN "PurchaseOrder" po ON po."id" = pr."purchaseOrderId"
                LEFT JOIN "Supplier" s ON s."id" = po."supplierId"
                WHERE pr."storeId" = ${storeId}
                  ${filters.from ? Prisma.sql`AND pr."receivedAt" >= ${filters.from}` : Prisma.sql``}
                  ${filters.to ? Prisma.sql`AND pr."receivedAt" <= ${filters.to}` : Prisma.sql``}
                  ${supplierFilterSql}
                GROUP BY s."id", supplier
                ORDER BY total DESC
                LIMIT 6
            `,
            prisma.$queryRaw<CategorySummaryRow[]>`
                SELECT
                    CASE
                        WHEN pri."itemType" = 'INGREDIENT' THEN 'Ingredients'
                        ELSE COALESCE(p."category", 'Uncategorized')
                    END AS category,
                    SUM(pri."qtyReceived" * pri."unitCost") AS total,
                    SUM(pri."qtyReceived") AS qty
                FROM "PurchaseReceiptItem" pri
                JOIN "PurchaseReceipt" pr ON pr."id" = pri."receiptId"
                LEFT JOIN "PurchaseOrder" po ON po."id" = pr."purchaseOrderId"
                LEFT JOIN "Supplier" s ON s."id" = po."supplierId"
                LEFT JOIN "Product" p ON p."id" = pri."productId"
                WHERE pr."storeId" = ${storeId}
                  ${filters.from ? Prisma.sql`AND pr."receivedAt" >= ${filters.from}` : Prisma.sql``}
                  ${filters.to ? Prisma.sql`AND pr."receivedAt" <= ${filters.to}` : Prisma.sql``}
                  ${supplierFilterSql}
                -- GROUP BY the select position: "category" would resolve to the
                -- Product.category input column, not the CASE alias (42803).
                GROUP BY 1
                ORDER BY total DESC
                LIMIT 6
            `,
        ]);

        const totalSpend = roundMoney(normalizeDecimal(totals._sum.totalCost));
        const totalReceipts = totals._count._all ?? 0;
        const avgReceipt = totalReceipts ? roundMoney(totalSpend / totalReceipts) : 0;

        return {
            totalReceipts,
            totalSpend,
            avgReceipt,
            suppliers: supplierRows.map((row) => ({
                supplierId: row.supplierId ?? null,
                supplierName: row.supplier ?? 'Unassigned',
                totalSpend: roundMoney(normalizeNumber(row.total)),
                receiptCount: normalizeNumber(row.receipts),
            })),
            categories: categoryRows.map((row) => ({
                category: row.category ?? 'Uncategorized',
                totalSpend: roundMoney(normalizeNumber(row.total)),
                qtyReceived: roundQty(normalizeNumber(row.qty)),
            })),
        };
    },
    create: async (
        storeId: string,
        input: {
            supplierId?: string;
            supplierName?: string;
            expectedDate?: Date;
            status?: PurchaseOrderStatus;
            items: PurchaseOrderItemInput[];
        }
    ) => {
        ensureStatusAllowed(input.status);
        const status = input.status ?? PurchaseOrderStatus.DRAFT;
        const { supplierId, supplierName } = await ensureSupplier(storeId, input.supplierId, input.supplierName);

        await validateItems(storeId, input.items);

        const purchaseOrder = await prisma.$transaction(async (tx) => {
            const created = await tx.purchaseOrder.create({
                data: {
                    storeId,
                    supplierId,
                    supplierName,
                    expectedDate: input.expectedDate,
                    status,
                },
            });

            await tx.purchaseOrderItem.createMany({
                data: input.items.map((item) => ({
                    purchaseOrderId: created.id,
                    itemType: item.itemType,
                    productId: item.itemType === ItemType.PRODUCT ? item.itemId : null,
                    ingredientId: item.itemType === ItemType.INGREDIENT ? item.itemId : null,
                    qtyOrdered: new Prisma.Decimal(item.qtyOrdered),
                    qtyReceived: new Prisma.Decimal(0),
                    unitCost: new Prisma.Decimal(item.unitCost ?? 0),
                })),
            });

            return created;
        });

        const updated = await purchaseOrderRepository.getById(storeId, purchaseOrder.id);
        if (!updated) {
            throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
        }

        return mapDetail(updated);
    },
    update: async (
        storeId: string,
        userId: string | undefined,
        purchaseOrderId: string,
        input: {
            supplierId?: string;
            supplierName?: string;
            expectedDate?: Date | null;
            status?: PurchaseOrderStatus;
        }
    ) => {
        if (!userId) {
            throw new AppError('UNAUTHORIZED', 'User is required to update purchase orders.', 401);
        }
        ensureStatusAllowed(input.status);

        const purchaseOrder = await purchaseOrderRepository.getById(storeId, purchaseOrderId);
        if (!purchaseOrder) {
            throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
        }

        ensureStatusUpdatable(purchaseOrder.status);
        if (input.status) {
            ensureStatusTransition(purchaseOrder.status, input.status);
        }

        if (input.status === PurchaseOrderStatus.CANCELLED) {
            const hasReceipts = purchaseOrder.items.some((item) => normalizeDecimal(item.qtyReceived) > 0);
            if (hasReceipts) {
                throw new AppError('INVALID_STATUS', 'Cannot cancel a purchase order with receipts.', 400);
            }
        }

        const data: Prisma.PurchaseOrderUncheckedUpdateManyInput = {};

        if (input.supplierId !== undefined || input.supplierName !== undefined) {
            const supplier = await ensureSupplier(storeId, input.supplierId, input.supplierName);
            data.supplierName = supplier.supplierName;
            data.supplierId = supplier.supplierId;
        }

        if (input.expectedDate !== undefined) {
            data.expectedDate = input.expectedDate;
        }

        if (input.status !== undefined) {
            data.status = input.status;
        }

        const statusChanged = input.status !== undefined && input.status !== purchaseOrder.status;

        await prisma.$transaction(async (tx) => {
            const updateResult = await tx.purchaseOrder.updateMany({
                where: {
                    id: purchaseOrderId,
                    storeId,
                    deletedAt: null,
                },
                data,
            });

            if (updateResult.count === 0) {
                throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
            }

            if (statusChanged && input.status) {
                await tx.auditLog.create({
                    data: {
                        store: { connect: { id: storeId } },
                        actor: { connect: { id: userId } },
                        action: 'PURCHASE_ORDER_STATUS',
                        entityType: 'PurchaseOrder',
                        entityId: purchaseOrderId,
                        meta: {
                            previousStatus: purchaseOrder.status,
                            nextStatus: input.status,
                        },
                    },
                });
            }
        });

        const updated = await purchaseOrderRepository.getById(storeId, purchaseOrderId);
        if (!updated) {
            throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
        }

        return mapDetail(updated);
    },
    receive: async (
        storeId: string,
        userId: string,
        purchaseOrderId: string,
        input: {
            invoiceNumber?: string;
            receivedAt?: Date;
            items: ReceiveItemInput[];
        }
    ) => {
        if (!userId) {
            throw new AppError('UNAUTHORIZED', 'User is required to receive a purchase order.', 401);
        }

        const incomingKeys = input.items.map((item) => buildItemKey(item.itemType, item.itemId));
        if (new Set(incomingKeys).size !== input.items.length) {
            throw new AppError('DUPLICATE_ITEM', 'Each item can only appear once.', 400);
        }

        const receipt = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`
                SELECT id
                FROM "PurchaseOrder"
                WHERE id = ${purchaseOrderId} AND "storeId" = ${storeId}
                FOR UPDATE
            `;
            await tx.$executeRaw`
                SELECT poi.id
                FROM "PurchaseOrderItem" poi
                JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
                WHERE poi."purchaseOrderId" = ${purchaseOrderId} AND po."storeId" = ${storeId}
                FOR UPDATE
            `;

            const purchaseOrder = await tx.purchaseOrder.findFirst({
                where: {
                    id: purchaseOrderId,
                    storeId,
                    deletedAt: null,
                },
                include: {
                    items: true,
                },
            });

            if (!purchaseOrder) {
                throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
            }

            if (
                purchaseOrder.status === PurchaseOrderStatus.CANCELLED ||
                purchaseOrder.status === PurchaseOrderStatus.RECEIVED
            ) {
                throw new AppError('INVALID_STATUS', 'Cannot receive a cancelled or completed purchase order.', 400);
            }

            const itemMap = new Map<string, (typeof purchaseOrder.items)[number]>();
            purchaseOrder.items.forEach((item) => {
                const itemId = item.itemType === ItemType.PRODUCT ? item.productId : item.ingredientId;
                if (!itemId) {
                    throw new AppError('INVALID_ITEM', 'Purchase order item is missing its reference.', 400);
                }
                itemMap.set(buildItemKey(item.itemType, itemId), item);
            });

            input.items.forEach((item) => {
                const poItem = itemMap.get(buildItemKey(item.itemType, item.itemId));
                if (!poItem) {
                    throw new AppError('INVALID_ITEM', 'Item is not part of this purchase order.', 400);
                }
                const qtyOrdered = normalizeDecimal(poItem.qtyOrdered);
                const qtyReceived = normalizeDecimal(poItem.qtyReceived);
                if (item.qtyReceived + qtyReceived > qtyOrdered) {
                    throw new AppError('OVER_RECEIVE', 'Received quantity exceeds ordered quantity.', 400);
                }
            });

            const productIds = input.items
                .filter((item) => item.itemType === ItemType.PRODUCT)
                .map((item) => item.itemId);
            const ingredientIds = input.items
                .filter((item) => item.itemType === ItemType.INGREDIENT)
                .map((item) => item.itemId);

            const itemNameMap = new Map<string, string>();

            if (productIds.length) {
                const products = await tx.product.findMany({
                    where: {
                        id: { in: productIds },
                        storeId,
                        deletedAt: null,
                    },
                    select: { id: true, type: true, name: true },
                });
                if (products.length !== new Set(productIds).size) {
                    throw new AppError('PRODUCT_NOT_FOUND', 'One or more products are missing.', 404);
                }
                const nonReadyMade = products.find((product) => product.type !== ProductType.READY_MADE);
                if (nonReadyMade) {
                    throw new AppError('INVALID_PRODUCT_TYPE', 'Only ready-made products can be received.', 400);
                }
                for (const product of products) {
                    itemNameMap.set(buildItemKey(ItemType.PRODUCT, product.id), product.name);
                }
            }

            if (ingredientIds.length) {
                const ingredients = await tx.ingredient.findMany({
                    where: {
                        id: { in: ingredientIds },
                        storeId,
                        deletedAt: null,
                    },
                    select: { id: true, name: true },
                });
                if (ingredients.length !== new Set(ingredientIds).size) {
                    throw new AppError('INGREDIENT_NOT_FOUND', 'One or more ingredients are missing.', 404);
                }
                for (const ingredient of ingredients) {
                    itemNameMap.set(buildItemKey(ItemType.INGREDIENT, ingredient.id), ingredient.name);
                }
            }

            const receiptItems = input.items.map((item) => {
                const poItem = itemMap.get(buildItemKey(item.itemType, item.itemId));
                if (!poItem) {
                    throw new AppError('INVALID_ITEM', 'Item is not part of this purchase order.', 400);
                }
                const unitCost = item.unitCost ?? normalizeDecimal(poItem.unitCost);
                const itemName = itemNameMap.get(buildItemKey(item.itemType, item.itemId)) ?? '';
                return {
                    itemType: item.itemType,
                    itemId: item.itemId,
                    itemName,
                    productId: item.itemType === ItemType.PRODUCT ? item.itemId : null,
                    ingredientId: item.itemType === ItemType.INGREDIENT ? item.itemId : null,
                    qtyReceived: item.qtyReceived,
                    unitCost,
                };
            });

            const receiptTotal = receiptItems.reduce((sum, item) => sum + item.qtyReceived * item.unitCost, 0);

            const createdReceipt = await tx.purchaseReceipt.create({
                data: {
                    storeId,
                    purchaseOrderId,
                    invoiceNumber: input.invoiceNumber ?? null,
                    receivedById: userId,
                    receivedAt: input.receivedAt ?? new Date(),
                    totalCost: new Prisma.Decimal(receiptTotal),
                },
            });

            await tx.purchaseReceiptItem.createMany({
                data: receiptItems.map((item) => ({
                    receiptId: createdReceipt.id,
                    itemType: item.itemType,
                    productId: item.productId,
                    ingredientId: item.ingredientId,
                    qtyReceived: new Prisma.Decimal(item.qtyReceived),
                    unitCost: new Prisma.Decimal(item.unitCost),
                })),
            });

            for (const item of receiptItems) {
                const poItem = itemMap.get(buildItemKey(item.itemType, item.itemId));
                if (!poItem) {
                    continue;
                }
                const updateResult = await tx.purchaseOrderItem.updateMany({
                    where: {
                        id: poItem.id,
                        purchaseOrderId,
                    },
                    data: {
                        qtyReceived: new Prisma.Decimal(
                            normalizeDecimal(poItem.qtyReceived) + item.qtyReceived
                        ),
                    },
                });

                if (updateResult.count === 0) {
                    throw new AppError('INVALID_ITEM', 'Purchase order item not found.', 404);
                }
            }

            const receiptItemMap = new Map(
                receiptItems.map((item) => [buildItemKey(item.itemType, item.itemId), item])
            );

            const allReceived = purchaseOrder.items.every((item) => {
                const itemId = item.itemType === ItemType.PRODUCT ? item.productId : item.ingredientId;
                if (!itemId) {
                    return false;
                }
                const receivedDelta = receiptItemMap.get(buildItemKey(item.itemType, itemId))?.qtyReceived ?? 0;
                const nextReceived = normalizeDecimal(item.qtyReceived) + receivedDelta;
                return nextReceived >= normalizeDecimal(item.qtyOrdered);
            });

            const nextStatus = allReceived
                ? PurchaseOrderStatus.RECEIVED
                : PurchaseOrderStatus.PARTIALLY_RECEIVED;

            const updateResult = await tx.purchaseOrder.updateMany({
                where: {
                    id: purchaseOrderId,
                    storeId,
                    deletedAt: null,
                },
                data: {
                    status: nextStatus,
                },
            });

            if (updateResult.count === 0) {
                throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
            }

            await tx.inventoryMovement.createMany({
                data: receiptItems.map((item) => ({
                    storeId,
                    itemType: item.itemType,
                    itemId: item.itemId,
                    qtyDelta: new Prisma.Decimal(item.qtyReceived),
                    unitCost: new Prisma.Decimal(item.unitCost),
                    type: MovementType.PURCHASE_RECEIPT,
                    referenceType: 'PURCHASE_RECEIPT',
                    referenceId: createdReceipt.id,
                    createdById: userId,
                })),
            });

            await tx.auditLog.create({
                data: {
                    store: { connect: { id: storeId } },
                    actor: { connect: { id: userId } },
                    action: 'PURCHASE_RECEIPT',
                    entityType: 'PurchaseReceipt',
                    entityId: createdReceipt.id,
                    meta: {
                        purchaseOrderId,
                        status: nextStatus,
                        invoiceNumber: input.invoiceNumber ?? null,
                        receivedAt: createdReceipt.receivedAt,
                        totalCost: receiptTotal,
                        items: receiptItems.map((item) => ({
                            itemType: item.itemType,
                            itemId: item.itemId,
                            itemName: item.itemName,
                            qtyReceived: item.qtyReceived,
                            unitCost: item.unitCost,
                        })),
                    },
                },
            });

            return createdReceipt;
        });

        const updated = await purchaseOrderRepository.getById(storeId, purchaseOrderId);
        if (!updated) {
            throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
        }

        return {
            receiptId: receipt.id,
            purchaseOrder: mapDetail(updated),
        };
    },
};
