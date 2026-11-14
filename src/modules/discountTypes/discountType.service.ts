import { DiscountMethod, DiscountScope, DiscountType, FieldRequirement, Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';
import type { DiscountTypeConfig } from '../sales/saleDiscounts';
import type { DiscountTypeCreateInput, DiscountTypeUpdateInput } from './discountType.schemas';

type Db = Prisma.TransactionClient | typeof prisma;

/** Senior Citizen (RA 9994) and PWD (RA 10754): 20% off the VAT-exclusive price, VAT-exempt. */
export const STATUTORY_PRESETS = [
    { code: 'SC', name: 'Senior Citizen', sortOrder: 0 },
    { code: 'PWD', name: 'Person with Disability', sortOrder: 1 },
].map((preset) => ({
    ...preset,
    statutory: true,
    method: DiscountMethod.PERCENT,
    value: 20,
    removesVat: true,
    scope: DiscountScope.BOTH,
    holderName: FieldRequirement.REQUIRED,
    holderIdNumber: FieldRequirement.REQUIRED,
    allowOnChannels: false,
    roundToWhole: true,
}));

/** Fields fixed by law on statutory presets. */
const STATUTORY_LOCKED = ['code', 'method', 'value', 'removesVat'] as const;

/** Creates any missing statutory presets; safe to call repeatedly. */
export const ensureStatutoryDiscountTypes = async (storeId: string, db: Db = prisma) => {
    await db.discountType.createMany({
        data: STATUTORY_PRESETS.map((preset) => ({ ...preset, storeId })),
        skipDuplicates: true,
    });
};

export const toDiscountTypeConfig = (row: DiscountType): DiscountTypeConfig => ({
    id: row.id,
    code: row.code,
    name: row.name,
    statutory: row.statutory,
    method: row.method,
    value: Number(row.value),
    removesVat: row.removesVat,
    scope: row.scope,
    holderName: row.holderName,
    holderIdNumber: row.holderIdNumber,
    allowOnChannels: row.allowOnChannels,
    roundToWhole: row.roundToWhole,
    isActive: row.isActive,
    archived: row.archivedAt !== null,
});

const toDto = (row: DiscountType) => ({
    ...toDiscountTypeConfig(row),
    sortOrder: row.sortOrder,
    lockedFields: row.statutory ? [...STATUTORY_LOCKED] : [],
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const findOrThrow = async (storeId: string, id: string) => {
    const row = await prisma.discountType.findFirst({ where: { id, storeId } });
    if (!row) {
        throw new AppError('NOT_FOUND', 'Discount not found', 404);
    }
    return row;
};

const isUniqueViolation = (error: unknown) =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const codeTaken = (code: string) =>
    new AppError('DISCOUNT_CODE_TAKEN', `Another discount already uses the code ${code}.`, 409, { code });

const auditMeta = (row: DiscountType) => ({
    code: row.code,
    name: row.name,
    method: row.method,
    value: Number(row.value),
    removesVat: row.removesVat,
    scope: row.scope,
    holderName: row.holderName,
    holderIdNumber: row.holderIdNumber,
    allowOnChannels: row.allowOnChannels,
    roundToWhole: row.roundToWhole,
    isActive: row.isActive,
});

export const discountTypeService = {
    list: async (storeId: string, includeArchived: boolean) => {
        await ensureStatutoryDiscountTypes(storeId);
        const rows = await prisma.discountType.findMany({
            where: { storeId, ...(includeArchived ? {} : { archivedAt: null }) },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });
        return rows.map(toDto);
    },

    create: async (storeId: string, actorId: string, input: DiscountTypeCreateInput) => {
        try {
            const row = await prisma.$transaction(async (tx) => {
                const created = await tx.discountType.create({ data: { ...input, storeId, statutory: false } });
                await tx.auditLog.create({
                    data: {
                        storeId,
                        actorId,
                        action: 'DISCOUNT_TYPE_CREATED',
                        entityType: 'DiscountType',
                        entityId: created.id,
                        meta: auditMeta(created),
                    },
                });
                return created;
            });
            return toDto(row);
        } catch (error) {
            if (isUniqueViolation(error)) throw codeTaken(input.code);
            throw error;
        }
    },

    update: async (storeId: string, actorId: string, id: string, input: DiscountTypeUpdateInput) => {
        const existing = await findOrThrow(storeId, id);
        if (existing.archivedAt) {
            throw new AppError('DISCOUNT_ARCHIVED', 'This discount was removed and can no longer be changed.', 400);
        }

        if (existing.statutory) {
            const current = { ...existing, value: Number(existing.value) };
            const changed = STATUTORY_LOCKED.filter(
                (field) => input[field] !== undefined && input[field] !== current[field]
            );
            if (changed.length) {
                throw new AppError(
                    'STATUTORY_DISCOUNT_LOCKED',
                    `${existing.name} is set by law; its ${changed.join(', ')} cannot be changed.`,
                    400,
                    { fields: changed }
                );
            }
        }

        const method = input.method ?? existing.method;
        const value = input.value ?? Number(existing.value);
        if (method === DiscountMethod.PERCENT && value > 100) {
            throw new AppError('INVALID_DISCOUNT_VALUE', 'A percentage cannot be more than 100.', 400);
        }

        try {
            const row = await prisma.$transaction(async (tx) => {
                const updated = await tx.discountType.update({ where: { id }, data: input });
                await tx.auditLog.create({
                    data: {
                        storeId,
                        actorId,
                        action: 'DISCOUNT_TYPE_UPDATED',
                        entityType: 'DiscountType',
                        entityId: id,
                        meta: { before: auditMeta(existing), after: auditMeta(updated) },
                    },
                });
                return updated;
            });
            return toDto(row);
        } catch (error) {
            if (isUniqueViolation(error) && input.code) throw codeTaken(input.code);
            throw error;
        }
    },

    /** Soft delete: past sales keep pointing at it. Statutory presets can only be turned off. */
    archive: async (storeId: string, actorId: string, id: string) => {
        const existing = await findOrThrow(storeId, id);
        if (existing.statutory) {
            throw new AppError(
                'STATUTORY_DISCOUNT_LOCKED',
                `${existing.name} can't be removed; turn it off instead.`,
                400
            );
        }
        if (existing.archivedAt) return;

        await prisma.$transaction(async (tx) => {
            await tx.discountType.update({ where: { id }, data: { archivedAt: new Date(), isActive: false } });
            await tx.auditLog.create({
                data: {
                    storeId,
                    actorId,
                    action: 'DISCOUNT_TYPE_ARCHIVED',
                    entityType: 'DiscountType',
                    entityId: id,
                    meta: auditMeta(existing),
                },
            });
        });
    },

    /** Store discount types by id, for pricing a sale. */
    loadConfigs: async (storeId: string, ids: string[]) => {
        if (!ids.length) return new Map<string, DiscountTypeConfig>();
        const rows = await prisma.discountType.findMany({ where: { storeId, id: { in: ids } } });
        return new Map(rows.map((row) => [row.id, toDiscountTypeConfig(row)]));
    },
};
