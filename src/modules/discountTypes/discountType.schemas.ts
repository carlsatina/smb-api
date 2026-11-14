import { DiscountMethod, DiscountScope, FieldRequirement } from '@prisma/client';
import { z } from 'zod';

const name = z.string().trim().min(1).max(60);
const code = z
    .string()
    .trim()
    .min(1)
    .max(10)
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z0-9_-]+$/.test(value), { message: 'Use letters, numbers, - or _ only.' });
const value = z.coerce.number().positive().max(9_999_999);

const fields = {
    name,
    method: z.nativeEnum(DiscountMethod),
    value,
    removesVat: z.boolean(),
    scope: z.nativeEnum(DiscountScope),
    holderName: z.nativeEnum(FieldRequirement),
    holderIdNumber: z.nativeEnum(FieldRequirement),
    allowOnChannels: z.boolean(),
    roundToWhole: z.boolean(),
    isActive: z.boolean(),
    sortOrder: z.coerce.number().int().min(0).max(9999),
};

const percentWithinRange = (data: { method?: DiscountMethod; value?: number }) =>
    data.method !== DiscountMethod.PERCENT || data.value === undefined || data.value <= 100;
const percentMessage = { message: 'A percentage cannot be more than 100.', path: ['value'] };

export const discountTypeCreateSchema = z
    .object({
        ...fields,
        code,
        removesVat: fields.removesVat.default(false),
        scope: fields.scope.default(DiscountScope.LINE),
        holderName: fields.holderName.default(FieldRequirement.OFF),
        holderIdNumber: fields.holderIdNumber.default(FieldRequirement.OFF),
        allowOnChannels: fields.allowOnChannels.default(false),
        roundToWhole: fields.roundToWhole.default(false),
        isActive: fields.isActive.default(true),
        sortOrder: fields.sortOrder.default(100),
    })
    .refine(percentWithinRange, percentMessage);

export const discountTypeUpdateSchema = z
    .object({ ...fields, code })
    .partial()
    .refine(percentWithinRange, percentMessage);

export const discountTypeListQuerySchema = z.object({
    includeArchived: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => value === 'true'),
});

export type DiscountTypeCreateInput = z.infer<typeof discountTypeCreateSchema>;
export type DiscountTypeUpdateInput = z.infer<typeof discountTypeUpdateSchema>;
