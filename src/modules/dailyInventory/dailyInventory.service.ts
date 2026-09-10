import { DailyInventoryReportType, ItemType, Prisma, Role } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';
import { getTemplateItems } from './dailyInventory.templates';

const parseDateOnlyUtc = (dateStr: string): Date => {
    const parts = dateStr.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
        throw new AppError('INVALID_DATE', 'Date must be formatted as YYYY-MM-DD', 400);
    }
    const [y, m, d] = parts;
    return new Date(Date.UTC(y, m - 1, d));
};

const formatDateOnlyUtc = (d: Date): string => {
    return d.toISOString().slice(0, 10);
};

const toNum = (v: Prisma.Decimal | number | null | undefined): number => {
    if (v === null || v === undefined) return 0;
    return Number(v);
};

export interface DailyReportItemDto {
    id?: string;
    section: string | null;
    particulars: string;
    unit: string;
    openingInventory: number;
    delivery: number;
    total: number;
    endingInventory: number | null;
    reminders: string | null;
    sortOrder: number;
    totalUsed: number | null;
    itemType?: ItemType | null;
    itemId?: string | null;
}

export interface DailyReportDto {
    id?: string;
    storeId: string;
    reportType: DailyInventoryReportType;
    date: string;
    isNew: boolean;
    carriedOverFromDate: string | null;
    items: DailyReportItemDto[];
    createdAt?: string;
    updatedAt?: string;
}

export interface SaveReportItemInput {
    id?: string;
    section?: string | null;
    particulars: string;
    unit: string;
    openingInventory: number;
    delivery: number;
    endingInventory?: number | null;
    reminders?: string | null;
    sortOrder?: number;
    itemType?: ItemType | null;
    itemId?: string | null;
}

export interface SaveDailyReportPayload {
    items: SaveReportItemInput[];
}

export const dailyInventoryService = {
    getDailyReport: async (
        storeId: string,
        reportType: DailyInventoryReportType,
        dateStr: string
    ): Promise<DailyReportDto> => {
        const targetDate = parseDateOnlyUtc(dateStr);

        // 1. Check if a report for this store, reportType and date already exists
        const existingReport = await prisma.dailyInventoryReport.findUnique({
            where: {
                storeId_reportType_date: {
                    storeId,
                    reportType,
                    date: targetDate,
                },
            },
            include: {
                items: {
                    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
                },
            },
        });

        if (existingReport) {
            return {
                id: existingReport.id,
                storeId: existingReport.storeId,
                reportType: existingReport.reportType,
                date: formatDateOnlyUtc(existingReport.date),
                isNew: false,
                carriedOverFromDate: null,
                items: existingReport.items.map((item) => {
                    const opening = toNum(item.openingInventory);
                    const delivery = toNum(item.delivery);
                    const total = opening + delivery;
                    const ending = item.endingInventory !== null ? toNum(item.endingInventory) : null;
                    const totalUsed = ending !== null ? Math.max(0, total - ending) : null;

                    return {
                        id: item.id,
                        section: item.section,
                        particulars: item.particulars,
                        unit: item.unit,
                        openingInventory: opening,
                        delivery,
                        total,
                        endingInventory: ending,
                        reminders: item.reminders,
                        sortOrder: item.sortOrder,
                        totalUsed,
                        itemType: item.itemType,
                        itemId: item.itemId,
                    };
                }),
                createdAt: existingReport.createdAt.toISOString(),
                updatedAt: existingReport.updatedAt.toISOString(),
            };
        }

        // 2. Report not found for this date: look for the most recent previous report
        const previousReport = await prisma.dailyInventoryReport.findFirst({
            where: {
                storeId,
                reportType,
                date: { lt: targetDate },
            },
            orderBy: { date: 'desc' },
            include: {
                items: {
                    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
                },
            },
        });

        if (previousReport && previousReport.items.length > 0) {
            // Carry over ending inventory as opening inventory
            const prevItemMap = new Map(
                previousReport.items.map((item) => [item.particulars.trim().toLowerCase(), item])
            );

            // Also check template particulars to ensure all template rows are present
            const templateItems = getTemplateItems(reportType);
            const items: DailyReportItemDto[] = [];
            const processedParticulars = new Set<string>();

            // First include items from previous report
            for (const prevItem of previousReport.items) {
                const normKey = prevItem.particulars.trim().toLowerCase();
                processedParticulars.add(normKey);

                const opening = prevItem.endingInventory !== null ? toNum(prevItem.endingInventory) : 0;
                const delivery = 0;
                const total = opening + delivery;

                items.push({
                    section: prevItem.section,
                    particulars: prevItem.particulars,
                    unit: prevItem.unit,
                    openingInventory: opening,
                    delivery: 0,
                    total,
                    endingInventory: null,
                    reminders: prevItem.reminders,
                    sortOrder: prevItem.sortOrder,
                    totalUsed: null,
                    itemType: prevItem.itemType,
                    itemId: prevItem.itemId,
                });
            }

            // Include any template items that weren't in the previous report
            for (const t of templateItems) {
                const normKey = t.particulars.trim().toLowerCase();
                if (!processedParticulars.has(normKey)) {
                    processedParticulars.add(normKey);
                    items.push({
                        section: t.section,
                        particulars: t.particulars,
                        unit: t.unit,
                        openingInventory: 0,
                        delivery: 0,
                        total: 0,
                        endingInventory: null,
                        reminders: t.reminders ?? null,
                        sortOrder: t.sortOrder,
                        totalUsed: null,
                    });
                }
            }

            items.sort((a, b) => a.sortOrder - b.sortOrder);

            return {
                storeId,
                reportType,
                date: dateStr,
                isNew: true,
                carriedOverFromDate: formatDateOnlyUtc(previousReport.date),
                items,
            };
        }

        // 3. No previous report exists: initialize from predefined template
        const templateItems = getTemplateItems(reportType);
        const items: DailyReportItemDto[] = templateItems.map((t) => ({
            section: t.section,
            particulars: t.particulars,
            unit: t.unit,
            openingInventory: 0,
            delivery: 0,
            total: 0,
            endingInventory: null,
            reminders: t.reminders ?? null,
            sortOrder: t.sortOrder,
            totalUsed: null,
        }));

        return {
            storeId,
            reportType,
            date: dateStr,
            isNew: true,
            carriedOverFromDate: null,
            items,
        };
    },

    saveDailyReport: async (
        storeId: string,
        reportType: DailyInventoryReportType,
        dateStr: string,
        payload: SaveDailyReportPayload,
        userRole: Role,
        userId: string
    ): Promise<DailyReportDto> => {
        const targetDate = parseDateOnlyUtc(dateStr);
        const isOwnerOrAdmin = userRole === Role.OWNER || userRole === Role.ADMIN;

        // Fetch existing report if any
        const existingReport = await prisma.dailyInventoryReport.findUnique({
            where: {
                storeId_reportType_date: {
                    storeId,
                    reportType,
                    date: targetDate,
                },
            },
            include: {
                items: true,
            },
        });

        // If user is store staff (not owner/admin), fetch previous day's report for opening values
        let prevItemMap: Map<string, Prisma.Decimal | null> = new Map();
        if (!isOwnerOrAdmin && !existingReport) {
            const previousReport = await prisma.dailyInventoryReport.findFirst({
                where: {
                    storeId,
                    reportType,
                    date: { lt: targetDate },
                },
                orderBy: { date: 'desc' },
                include: { items: true },
            });
            if (previousReport) {
                prevItemMap = new Map(
                    previousReport.items.map((i) => [i.particulars.trim().toLowerCase(), i.endingInventory])
                );
            }
        }

        const existingItemMap = new Map(
            existingReport?.items.map((i) => [i.particulars.trim().toLowerCase(), i]) ?? []
        );

        // Prepare items with role-based opening inventory protection
        const preparedItems = payload.items.map((submittedItem, idx) => {
            const normKey = submittedItem.particulars.trim().toLowerCase();
            let openingVal = submittedItem.openingInventory;

            if (!isOwnerOrAdmin) {
                // Store staff CANNOT edit opening inventory:
                if (existingItemMap.has(normKey)) {
                    openingVal = toNum(existingItemMap.get(normKey)?.openingInventory);
                } else if (prevItemMap.has(normKey)) {
                    openingVal = toNum(prevItemMap.get(normKey));
                } else {
                    openingVal = 0;
                }
            }

            return {
                section: submittedItem.section || null,
                particulars: submittedItem.particulars.trim(),
                unit: submittedItem.unit.trim(),
                openingInventory: new Prisma.Decimal(openingVal || 0),
                delivery: new Prisma.Decimal(submittedItem.delivery || 0),
                endingInventory:
                    submittedItem.endingInventory !== null && submittedItem.endingInventory !== undefined
                        ? new Prisma.Decimal(submittedItem.endingInventory)
                        : null,
                reminders: submittedItem.reminders?.trim() || null,
                sortOrder: submittedItem.sortOrder ?? idx + 1,
                itemType: submittedItem.itemType || null,
                itemId: submittedItem.itemId || null,
            };
        });

        const report = await prisma.$transaction(async (tx) => {
            // Upsert report record
            const rep = await tx.dailyInventoryReport.upsert({
                where: {
                    storeId_reportType_date: {
                        storeId,
                        reportType,
                        date: targetDate,
                    },
                },
                create: {
                    storeId,
                    reportType,
                    date: targetDate,
                    createdById: userId,
                },
                update: {
                    // Touch updatedAt
                    updatedAt: new Date(),
                },
            });

            // Delete old items and insert updated items
            await tx.dailyInventoryReportItem.deleteMany({
                where: { reportId: rep.id },
            });

            await tx.dailyInventoryReportItem.createMany({
                data: preparedItems.map((item) => ({
                    reportId: rep.id,
                    ...item,
                })),
            });

            return rep;
        });

        // Return updated report DTO
        return dailyInventoryService.getDailyReport(storeId, reportType, dateStr);
    },
};
