import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';

export const mcpRepository = {
    /** Settings an AI may read. No AI key, role permissions or billing fields. */
    getStoreSettings: (storeId: string) =>
        prisma.store.findFirst({
            where: { id: storeId, deletedAt: null },
            select: {
                name: true,
                storeType: true,
                timezone: true,
                currency: true,
                lowStockThreshold: true,
                defaultTaxRate: true,
                defaultDiscount: true,
                allowNegativeStock: true,
                cashierSalesHistoryLimit: true,
                paymentMethods: true,
                unitOptions: true,
                categoryOptions: true,
                subcategoryOptions: true,
                expenseCategoryOptions: true,
                salesChannels: true,
            },
        }),

    createAuditLog: (data: {
        storeId: string;
        actorId: string;
        action: string;
        entityType: string;
        entityId: string;
        meta: Prisma.InputJsonValue;
    }) => prisma.auditLog.create({ data }),
};
