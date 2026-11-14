import { OrderType, PaymentMethod, SaleStatus } from '@prisma/client';
import { z } from 'zod';

const optionalString = z.string().min(1).optional();

const numericValue = (value: unknown) => {
    if (value === null || value === undefined || value === '') {
        return undefined;
    }
    if (typeof value === 'string') {
        return Number(value);
    }
    return value;
};

const requiredNumber = z.preprocess(numericValue, z.number());
const nonNegativeNumber = z.preprocess(numericValue, z.number().nonnegative());
const positiveNumber = requiredNumber.refine((value) => value > 0, {
    message: 'Value must be greater than 0.',
});

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

export const saleItemSchema = z.object({
    productId: z.string().min(1),
    qty: positiveNumber,
    unitPrice: nonNegativeNumber,
    discount: nonNegativeNumber.optional(),
    tax: nonNegativeNumber.optional(),
    // Points at a LINE-scope entry in `discounts`; the server prices the line.
    discountRef: z.string().min(1).max(64).optional(),
});

const holderField = z.string().trim().max(120).nullable().optional();

export const saleDiscountSchema = z.object({
    // Client-chosen key that items use in `discountRef`. When editing, the id of
    // an existing sale discount keeps its original snapshot.
    ref: z.string().min(1).max(64),
    discountTypeId: z.string().min(1),
    scope: z.enum(['LINE', 'SALE']),
    holderName: holderField,
    holderIdNumber: holderField,
    // Sale-wide Senior/PWD on a group meal: diners at the table, and how many get the discount.
    dinerCount: z.number().int().min(1).max(500).optional(),
    holderCount: z.number().int().min(1).max(500).optional(),
});

export const saleFinalizeSchema = z.object({
    items: z.array(saleItemSchema).min(1),
    paymentMethod: z.nativeEnum(PaymentMethod),
    orderType: z.nativeEnum(OrderType).default(OrderType.DINE_IN),
    customDate: dateValue.optional(),
    channel: z.string().min(1).max(30).nullable().optional(),
    discounts: z.array(saleDiscountSchema).max(50).optional(),
});

export const saleUpdateSchema = z.object({
    items: z.array(saleItemSchema).min(1),
    paymentMethod: z.nativeEnum(PaymentMethod),
    orderType: z.nativeEnum(OrderType),
    // Omit to edit a sale without discounts the old way; required once a sale has any.
    discounts: z.array(saleDiscountSchema).max(50).optional(),
});

export const saleListQuerySchema = z.object({
    status: z.nativeEnum(SaleStatus).optional(),
    from: dateValue.optional(),
    to: dateValue.optional(),
    cashierId: optionalString,
    paymentMethod: z.nativeEnum(PaymentMethod).optional(),
    productId: optionalString,
    channel: optionalString,
    page: z
        .preprocess((value) => (value === undefined ? 1 : Number(value)), z.number().int().min(1))
        .default(1),
    pageSize: z
        .preprocess((value) => (value === undefined ? 25 : Number(value)), z.number().int().min(1).max(100))
        .default(25),
});

export const saleExportQuerySchema = z.object({
    status: z.nativeEnum(SaleStatus).optional(),
    from: dateValue.optional(),
    to: dateValue.optional(),
    cashierId: optionalString,
    paymentMethod: z.nativeEnum(PaymentMethod).optional(),
    productId: optionalString,
    channel: optionalString,
});

export const saleDeleteSchema = z.object({
    reason: z.string().trim().max(300).nullable().optional(),
});

// The owner types this phrase in the UI; the API requires it too so a stray
// DELETE /sales can never wipe the history.
export const DELETE_SALES_PHRASE = 'DELETE';

// Bulk delete takes the same filters as the sales list, plus the count the
// owner saw, so it removes exactly what was on screen or nothing.
export const saleBulkDeleteSchema = saleExportQuerySchema.extend({
    confirm: z.literal(DELETE_SALES_PHRASE, { error: `Type "${DELETE_SALES_PHRASE}" to confirm.` }),
    expectedCount: z.number().int().min(1),
    filterSummary: z.string().trim().max(300).nullable().optional(),
    reason: z.string().trim().max(300).nullable().optional(),
});
