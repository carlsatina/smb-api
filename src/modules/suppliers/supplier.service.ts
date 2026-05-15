import { Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors';
import prisma from '../../../lib/prisma';
import { supplierRepository } from './supplier.repository';

type SupplierCreateData = Omit<Prisma.SupplierCreateInput, 'store'>;

const buildSupplierChanges = (
    before: { name: string; email: string | null; phone: string | null },
    after: { name: string; email: string | null; phone: string | null }
) => {
    const changes: Record<string, { from: string | null; to: string | null }> = {};
    const fields: Array<'name' | 'email' | 'phone'> = ['name', 'email', 'phone'];
    fields.forEach((field) => {
        const previous = before[field] ?? null;
        const next = after[field] ?? null;
        if (previous !== next) {
            changes[field] = { from: previous, to: next };
        }
    });
    return changes;
};

export const supplierService = {
    list: async (storeId: string) => {
        return supplierRepository.listByStore(storeId);
    },
    get: async (storeId: string, supplierId: string) => {
        const supplier = await supplierRepository.getById(storeId, supplierId);
        if (!supplier) {
            throw new AppError('NOT_FOUND', 'Supplier not found', 404);
        }
        return supplier;
    },
    create: async (storeId: string, data: SupplierCreateData) => {
        try {
            return await supplierRepository.create(storeId, data);
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new AppError('DUPLICATE', 'Supplier with same name already exists', 409);
            }
            throw error;
        }
    },
    update: async (
        storeId: string,
        supplierId: string,
        data: Prisma.SupplierUpdateInput,
        userId?: string
    ) => {
        try {
            const existing = await supplierRepository.getById(storeId, supplierId);
            if (!existing) {
                throw new AppError('NOT_FOUND', 'Supplier not found', 404);
            }

            const updated = await prisma.$transaction(async (tx) => {
                const updateResult = await tx.supplier.updateMany({
                    where: {
                        id: supplierId,
                        storeId,
                        deletedAt: null,
                    },
                    data: data as Prisma.SupplierUpdateManyMutationInput,
                });

                if (updateResult.count === 0) {
                    throw new AppError('NOT_FOUND', 'Supplier not found', 404);
                }

                const result = await tx.supplier.findFirst({
                    where: {
                        id: supplierId,
                        storeId,
                    },
                });

                if (!result) {
                    throw new AppError('NOT_FOUND', 'Supplier not found', 404);
                }

                const changes = buildSupplierChanges(
                    { name: existing.name, email: existing.email, phone: existing.phone },
                    { name: result.name, email: result.email, phone: result.phone }
                );

                if (Object.keys(changes).length > 0) {
                    const auditData: Prisma.AuditLogCreateInput = {
                        store: { connect: { id: storeId } },
                        action: 'SUPPLIER_UPDATED',
                        entityType: 'Supplier',
                        entityId: supplierId,
                        meta: { changes },
                    };
                    if (userId) {
                        auditData.actor = { connect: { id: userId } };
                    }
                    await tx.auditLog.create({ data: auditData });
                }

                return result;
            });

            return updated;
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new AppError('DUPLICATE', 'Supplier with same name already exists', 409);
            }
            throw error;
        }
    },
    remove: async (storeId: string, supplierId: string) => {
        const deleted = await supplierRepository.softDelete(storeId, supplierId);
        if (!deleted) {
            throw new AppError('NOT_FOUND', 'Supplier not found', 404);
        }
    },
};
