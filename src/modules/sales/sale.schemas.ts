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
});

export const saleFinalizeSchema = z.object({
    items: z.array(saleItemSchema).min(1),
    paymentMethod: z.nativeEnum(PaymentMethod),
    orderType: z.nativeEnum(OrderType).default(OrderType.DINE_IN),
});

export const saleListQuerySchema = z.object({
    status: z.nativeEnum(SaleStatus).optional(),
    from: dateValue.optional(),
    to: dateValue.optional(),
    cashierId: optionalString,
    paymentMethod: z.nativeEnum(PaymentMethod).optional(),
    productId: optionalString,
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
});
