import { ItemType, PurchaseOrderStatus } from '@prisma/client';
import { z } from 'zod';

const optionalString = z.string().min(1).optional();

const requiredNumber = z.preprocess(
    (value) => {
        if (typeof value === 'string') {
            return Number(value);
        }
        return value;
    },
    z.number()
);

const positiveNumber = requiredNumber.refine((value) => value > 0, {
    message: 'Value must be greater than 0.',
});

const nonNegativeNumber = z.preprocess(
    (value) => {
        if (value === null || value === undefined || value === '') {
            return undefined;
        }
        if (typeof value === 'string') {
            return Number(value);
        }
        return value;
    },
    z.number().nonnegative()
).optional();

const dateValue = z.preprocess(
    (value) => {
        if (value === null || value === undefined || value === '') {
            return undefined;
        }
        if (value instanceof Date) {
            return value;
        }
        return new Date(String(value));
    },
    z.date()
);

const nullableDateValue = z.preprocess(
    (value) => {
        if (value === '') {
            return null;
        }
        if (value === null) {
            return null;
        }
        if (value === undefined) {
            return undefined;
        }
        if (value instanceof Date) {
            return value;
        }
        return new Date(String(value));
    },
    z.union([z.date(), z.null()])
);

export const purchaseOrderItemSchema = z.object({
    itemType: z.nativeEnum(ItemType),
    itemId: z.string().min(1),
    qtyOrdered: positiveNumber,
    unitCost: nonNegativeNumber,
});

export const createPurchaseOrderSchema = z.object({
    supplierId: optionalString,
    supplierName: optionalString,
    expectedDate: dateValue.optional(),
    status: z.nativeEnum(PurchaseOrderStatus).optional(),
    items: z.array(purchaseOrderItemSchema).min(1),
});

export const updatePurchaseOrderSchema = z
    .object({
        supplierId: optionalString,
        supplierName: optionalString,
        expectedDate: nullableDateValue.optional(),
        status: z.nativeEnum(PurchaseOrderStatus).optional(),
    })
    .refine(
        (data) =>
            data.supplierId !== undefined ||
            data.supplierName !== undefined ||
            data.expectedDate !== undefined ||
            data.status !== undefined,
        {
            message: 'Provide at least one field to update.',
        }
    );

export const receivePurchaseOrderItemSchema = z.object({
    itemType: z.nativeEnum(ItemType),
    itemId: z.string().min(1),
    qtyReceived: positiveNumber,
    unitCost: nonNegativeNumber,
});

export const receivePurchaseOrderSchema = z.object({
    invoiceNumber: optionalString,
    receivedAt: dateValue.optional(),
    items: z.array(receivePurchaseOrderItemSchema).min(1),
});

export const purchaseReceiptListQuerySchema = z.object({
    q: optionalString,
    from: dateValue.optional(),
    to: dateValue.optional(),
    supplierId: optionalString,
    supplierName: optionalString,
    page: z
        .preprocess((value) => (value === undefined ? 1 : Number(value)), z.number().int().min(1))
        .default(1),
    pageSize: z
        .preprocess((value) => (value === undefined ? 25 : Number(value)), z.number().int().min(1).max(100))
        .default(25),
});

export const purchaseReceiptSummaryQuerySchema = z.object({
    from: dateValue.optional(),
    to: dateValue.optional(),
    supplierId: optionalString,
    supplierName: optionalString,
});

export const purchaseOrderListQuerySchema = z.object({
    status: z.nativeEnum(PurchaseOrderStatus).optional(),
    q: optionalString,
    supplierId: optionalString,
    supplierName: optionalString,
    from: dateValue.optional(),
    to: dateValue.optional(),
    page: z
        .preprocess((value) => (value === undefined ? 1 : Number(value)), z.number().int().min(1))
        .default(1),
    pageSize: z
        .preprocess((value) => (value === undefined ? 25 : Number(value)), z.number().int().min(1).max(100))
        .default(25),
});
