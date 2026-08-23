import { Prisma, ScheduleWeekStatus } from '@prisma/client';
import prisma from '../../../lib/prisma';

const weekInclude = {
    rows: {
        include: {
            shifts: {
                orderBy: { date: 'asc' as const },
                include: { preset: { select: { icon: true, label: true } } },
            },
            storeMember: { include: { user: { select: { id: true, fullName: true, email: true } } } },
            caDeductions: { include: { cashAdvance: true } },
        },
        orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    },
} satisfies Prisma.ScheduleWeekInclude;

export type ScheduleWeekWithRows = Prisma.ScheduleWeekGetPayload<{ include: typeof weekInclude }>;

export type PresetData = {
    label: string;
    icon: string;
    startMinute: number;
    endMinute: number;
    sortOrder: number;
};

export const scheduleRepository = {
    findWeek: (storeId: string, weekStart: Date) =>
        prisma.scheduleWeek.findFirst({
            where: { storeId, weekStart, deletedAt: null },
            include: weekInclude,
        }),

    findWeekById: (storeId: string, weekId: string) =>
        prisma.scheduleWeek.findFirst({
            where: { id: weekId, storeId, deletedAt: null },
            include: weekInclude,
        }),

    // Full weeks across a range, in one query — the month views resolve
    // compensation and balances in memory rather than per row.
    listWeeksInRange: (storeId: string, from: Date, to: Date) =>
        prisma.scheduleWeek.findMany({
            where: { storeId, deletedAt: null, weekStart: { gte: from, lte: to } },
            include: weekInclude,
            orderBy: { weekStart: 'asc' },
        }),

    // Shifts for one member across a date range, for the per-staff calendar.
    listMemberShifts: (storeId: string, storeMemberId: string, from: Date, to: Date) =>
        prisma.scheduleShift.findMany({
            where: {
                date: { gte: from, lte: to },
                scheduleWeekRow: {
                    storeMemberId,
                    scheduleWeek: { storeId, deletedAt: null },
                },
            },
            include: {
                preset: { select: { id: true, label: true, icon: true } },
                scheduleWeekRow: { select: { scheduleWeek: { select: { status: true, weekStart: true } } } },
            },
            orderBy: { date: 'asc' },
        }),

    listWeeks: (storeId: string, from: Date | undefined, to: Date | undefined, limit: number) =>
        prisma.scheduleWeek.findMany({
            where: {
                storeId,
                deletedAt: null,
                ...(from || to
                    ? { weekStart: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
                    : {}),
            },
            orderBy: { weekStart: 'desc' },
            take: limit,
            select: { id: true, weekStart: true, status: true, publishedAt: true },
        }),

    createWeek: (storeId: string, weekStart: Date, createdById: string) =>
        prisma.scheduleWeek.create({
            data: { storeId, weekStart, createdById },
            include: weekInclude,
        }),

    setWeekStatus: (weekId: string, status: ScheduleWeekStatus, publishedAt: Date | null) =>
        prisma.scheduleWeek.update({
            where: { id: weekId },
            data: { status, publishedAt },
        }),

    listMembers: (storeId: string) =>
        prisma.storeMember.findMany({
            where: { storeId, deletedAt: null },
            include: { user: { select: { id: true, fullName: true, email: true } } },
            orderBy: { createdAt: 'asc' },
        }),

    findMemberByUser: (storeId: string, userId: string) =>
        prisma.storeMember.findFirst({ where: { storeId, userId, deletedAt: null } }),

    listPresets: (storeId: string) =>
        prisma.shiftPreset.findMany({
            where: { storeId, deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { startMinute: 'asc' }],
        }),

    createPreset: (storeId: string, data: PresetData) =>
        prisma.shiftPreset.create({ data: { storeId, ...data } }),

    updatePreset: (storeId: string, presetId: string, data: PresetData) =>
        prisma.shiftPreset.updateMany({ where: { id: presetId, storeId, deletedAt: null }, data }),

    findWeekForDelete: (storeId: string, weekId: string) =>
        prisma.scheduleWeek.findFirst({ where: { id: weekId, storeId, deletedAt: null } }),

    softDeleteWeek: (weekId: string) =>
        prisma.scheduleWeek.update({ where: { id: weekId }, data: { deletedAt: new Date() } }),

    softDeletePreset: (storeId: string, presetId: string) =>
        prisma.shiftPreset.updateMany({
            where: { id: presetId, storeId, deletedAt: null },
            data: { deletedAt: new Date() },
        }),

    // Rate in force on `onDate` for a member — the row whose window contains it.
    findCompensationOn: (storeMemberId: string, onDate: Date) =>
        prisma.staffCompensation.findFirst({
            where: {
                storeMemberId,
                effectiveFrom: { lte: onDate },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
            },
            orderBy: { effectiveFrom: 'desc' },
        }),

    // Members who already appear on some week's schedule. Used so the rates
    // list can still reach someone who is no longer offered in the staff
    // dropdown but is already rostered.
    listScheduledMemberIds: (storeId: string) =>
        prisma.scheduleWeekRow.findMany({
            where: { scheduleWeek: { storeId, deletedAt: null } },
            select: { storeMemberId: true },
            distinct: ['storeMemberId'],
        }),

    listCompensations: (storeId: string) =>
        prisma.staffCompensation.findMany({
            where: { storeId },
            orderBy: [{ storeMemberId: 'asc' }, { effectiveFrom: 'desc' }],
        }),

    listCashAdvances: (storeId: string, storeMemberIds?: string[]) =>
        prisma.cashAdvance.findMany({
            where: {
                storeId,
                deletedAt: null,
                ...(storeMemberIds ? { storeMemberId: { in: storeMemberIds } } : {}),
            },
            include: { deductions: true },
            orderBy: { takenOn: 'asc' },
        }),

    createCashAdvance: (
        storeId: string,
        data: { storeMemberId: string; amount: Prisma.Decimal; takenOn: Date; note: string | null; createdById: string }
    ) => prisma.cashAdvance.create({ data: { storeId, ...data } }),

    softDeleteCashAdvance: (storeId: string, cashAdvanceId: string) =>
        prisma.cashAdvance.updateMany({
            where: { id: cashAdvanceId, storeId, deletedAt: null },
            data: { deletedAt: new Date() },
        }),

    // ── Time clock ────────────────────────────────────────────────────────────

    // Punches carry instants, but every reconciliation is expressed in the
    // store's local day — so the timezone is needed on every attendance path.
    findStoreTimezone: (storeId: string) =>
        prisma.store.findFirst({ where: { id: storeId, deletedAt: null }, select: { timezone: true } }),

    // Rostered shifts for a whole store over a range, for the attendance grid.
    listShiftsInRange: (storeId: string, from: Date, to: Date) =>
        prisma.scheduleShift.findMany({
            where: {
                date: { gte: from, lte: to },
                scheduleWeekRow: { scheduleWeek: { storeId, deletedAt: null } },
            },
            include: {
                preset: { select: { label: true, icon: true } },
                scheduleWeekRow: {
                    select: {
                        storeMemberId: true,
                        scheduleWeek: { select: { status: true } },
                    },
                },
            },
            orderBy: { date: 'asc' },
        }),

    // At most one punch may be open per member; the service enforces that, and
    // this is how it checks.
    findOpenTimeEntry: (storeId: string, storeMemberId: string) =>
        prisma.timeEntry.findFirst({
            where: { storeId, storeMemberId, clockOutAt: null, deletedAt: null },
            orderBy: { clockInAt: 'desc' },
        }),

    findTimeEntry: (storeId: string, id: string) =>
        prisma.timeEntry.findFirst({ where: { id, storeId, deletedAt: null } }),

    listTimeEntries: (storeId: string, from: Date, to: Date, storeMemberIds?: string[]) =>
        prisma.timeEntry.findMany({
            where: {
                storeId,
                deletedAt: null,
                workDate: { gte: from, lte: to },
                ...(storeMemberIds ? { storeMemberId: { in: storeMemberIds } } : {}),
            },
            include: { editedBy: { select: { fullName: true, email: true } } },
            orderBy: [{ workDate: 'asc' }, { clockInAt: 'asc' }],
        }),

    createTimeEntry: (data: Prisma.TimeEntryUncheckedCreateInput) => prisma.timeEntry.create({ data }),

    // Clock-in guarded against a double punch: the check and the insert share a
    // transaction, so a double-tapped button cannot leave two open entries.
    // Returns null when the member already has one open.
    createTimeEntryIfIdle: (data: Prisma.TimeEntryUncheckedCreateInput) =>
        prisma.$transaction(async (tx) => {
            const open = await tx.timeEntry.findFirst({
                where: {
                    storeId: data.storeId,
                    storeMemberId: data.storeMemberId,
                    clockOutAt: null,
                    deletedAt: null,
                },
            });
            if (open) return null;
            return tx.timeEntry.create({ data });
        }),

    updateTimeEntry: (id: string, data: Prisma.TimeEntryUncheckedUpdateInput) =>
        prisma.timeEntry.update({ where: { id }, data }),

    softDeleteTimeEntry: (storeId: string, id: string) =>
        prisma.timeEntry.updateMany({
            where: { id, storeId, deletedAt: null },
            data: { deletedAt: new Date() },
        }),
};

export type TimeEntryRow = Prisma.TimeEntryGetPayload<{
    include: { editedBy: { select: { fullName: true; email: true } } };
}>;

export type RangeShiftRow = Prisma.ScheduleShiftGetPayload<{
    include: {
        preset: { select: { label: true; icon: true } };
        scheduleWeekRow: { select: { storeMemberId: true; scheduleWeek: { select: { status: true } } } };
    };
}>;
