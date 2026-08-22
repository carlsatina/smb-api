import { Prisma, Role, ScheduleWeekStatus } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AppError } from '../../shared/errors';
import { PresetData, scheduleRepository, ScheduleWeekWithRows } from './schedule.repository';
import { computeOtHours, computePayout, countDaysWorked, otHourlyRate } from './schedule.payroll';

// The week grid runs Sunday → Saturday, matching the payroll sheet this
// replaces. If stores ever need a different start day this becomes a Store
// column; until then it is a single constant rather than a hidden assumption.
const WEEK_START_DAY = 0; // 0 = Sunday

const MANAGER_ROLES: Role[] = [Role.OWNER, Role.ADMIN];

const toNum = (v: Prisma.Decimal | null | undefined) => Number(v ?? 0);

// Date-only columns are stored at UTC midnight, matching the expenses convention.
const toUtcDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const toDateString = (date: Date): string => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number): Date =>
    new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const assertWeekStart = (weekStart: string): Date => {
    const date = toUtcDate(weekStart);
    if (Number.isNaN(date.getTime())) {
        throw new AppError('INVALID_WEEK_START', 'Week start is not a valid date', 400);
    }
    if (date.getUTCDay() !== WEEK_START_DAY) {
        throw new AppError('INVALID_WEEK_START', 'Week must start on a Sunday', 400);
    }
    return date;
};

const weekDates = (weekStart: Date): string[] =>
    Array.from({ length: 7 }, (_, i) => toDateString(addDays(weekStart, i)));

export type Viewer = { userId: string; role: Role };

const isManager = (viewer: Viewer) => MANAGER_ROLES.includes(viewer.role);

// The owner runs the store rather than working a rostered shift, so they are
// left out of the schedulable-staff list and the pay-rate list. Filtered here at
// the presentation edge, not in the repository: `upsertWeek` validates against
// the full membership list so a week that already contains an owner row still
// saves. ADMIN stays in — an admin may well work shifts.
const isSchedulableStaff = (role: Role) => role !== Role.OWNER;

type CompRow = {
    storeMemberId: string;
    dailyRate: Prisma.Decimal;
    hoursPerDay: Prisma.Decimal;
    otMultiplier: Prisma.Decimal;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    breakMinutes: number;
};

// Resolves the rate in force on a date from a prefetched list. Callers load the
// store's compensation rows once and resolve in memory — a per-row query here
// turns any multi-week view into an N+1.
const compensationOn = (comps: CompRow[], storeMemberId: string, onDate: Date): CompRow | null => {
    let best: CompRow | null = null;
    for (const c of comps) {
        if (c.storeMemberId !== storeMemberId) continue;
        if (c.effectiveFrom > onDate) continue;
        if (c.effectiveTo !== null && c.effectiveTo < onDate) continue;
        if (!best || c.effectiveFrom > best.effectiveFrom) best = c;
    }
    return best;
};

// Payout math lives in ./schedule.payroll (pure, unit-tested). This adapts the
// Prisma Decimal columns onto it.

const otHourlyRateFrom = (comp: { dailyRate: Prisma.Decimal; hoursPerDay: Prisma.Decimal; otMultiplier: Prisma.Decimal }) =>
    otHourlyRate({
        dailyRate: toNum(comp.dailyRate),
        hoursPerDay: toNum(comp.hoursPerDay),
        otMultiplier: toNum(comp.otMultiplier),
    });

// ── Serialisation + role masking ──────────────────────────────────────────────
// Pay columns are omitted from the payload for members viewing someone else's
// row. This is the real access control — the client hiding columns is only UX.

type RowPay = {
    daysWorked: number;
    otHours: number;
    dailyRate: number;
    otHourlyRate: number;
    lessCa: number;
    payout: number;
    otAuto: boolean;
    computedOtHours: number;
    hoursPerDay: number;
    breakMinutes: number;
    remarks: string | null;
    caBalance: number;
    deductions: { id: string; cashAdvanceId: string; amount: number; skipped: boolean; reason: string | null }[];
};

const serialiseShift = (shift: ScheduleWeekWithRows['rows'][number]['shifts'][number]) => ({
    id: shift.id,
    date: toDateString(shift.date),
    isRestDay: shift.isRestDay,
    startMinute: shift.startMinute,
    endMinute: shift.endMinute,
    presetId: shift.presetId,
    // Resolved server-side, deliberately including soft-deleted presets: a
    // shift worked last month keeps its icon even after the preset is retired.
    icon: shift.preset?.icon ?? 'none',
    presetLabel: shift.preset?.label ?? null,
});

const buildRowPay = (
    row: ScheduleWeekWithRows['rows'][number],
    weekStart: Date,
    published: boolean,
    caBalance: number,
    comps: CompRow[]
): RowPay => {
    const daysWorked = countDaysWorked(row.shifts);
    const lessCa = row.caDeductions.reduce((sum, d) => sum + toNum(d.amount), 0);

    let dailyRate: number;
    let rowOtHourlyRate: number;
    let hoursPerDay = 8;
    let breakMinutes = 0;

    const comp = compensationOn(comps, row.storeMemberId, weekStart);
    if (comp) {
        hoursPerDay = toNum(comp.hoursPerDay) || 8;
        breakMinutes = comp.breakMinutes;
    }

    if (published && row.dailyRate !== null && row.otHourlyRate !== null) {
        // Settled week: use the frozen rates so history cannot drift.
        dailyRate = toNum(row.dailyRate);
        rowOtHourlyRate = toNum(row.otHourlyRate);
    } else {
        dailyRate = comp ? toNum(comp.dailyRate) : 0;
        rowOtHourlyRate = comp ? otHourlyRateFrom(comp) : 0;
    }

    const computedOt = computeOtHours(row.shifts, hoursPerDay, breakMinutes);
    // A published row keeps whatever OT it was settled with; a draft on auto
    // tracks the roster, and a manual row keeps the owner's number.
    const otHours = published || !row.otAuto ? toNum(row.otHours) : computedOt;

    return {
        daysWorked,
        otHours,
        dailyRate,
        otHourlyRate: rowOtHourlyRate,
        lessCa,
        payout: computePayout({ daysWorked, dailyRate, otHours, otHourlyRate: rowOtHourlyRate, lessCa }),
        otAuto: row.otAuto,
        computedOtHours: computedOt,
        hoursPerDay,
        breakMinutes,
        remarks: row.remarks,
        caBalance,
        deductions: row.caDeductions.map((d) => ({
            id: d.id,
            cashAdvanceId: d.cashAdvanceId,
            amount: toNum(d.amount),
            skipped: d.skipped,
            reason: d.reason,
        })),
    };
};

const memberName = (row: ScheduleWeekWithRows['rows'][number]) =>
    row.storeMember.user.fullName || row.storeMember.user.email;

const serialiseWeek = (
    week: ScheduleWeekWithRows,
    viewer: Viewer,
    balances: Map<string, number>,
    comps: CompRow[]
) => {
    const published = week.status === ScheduleWeekStatus.PUBLISHED;
    const viewerMemberIds = new Set(
        week.rows.filter((r) => r.storeMember.userId === viewer.userId).map((r) => r.storeMemberId)
    );

    const rows = week.rows.map((row) => {
        const canSeePay = isManager(viewer) || viewerMemberIds.has(row.storeMemberId);
        const base = {
            id: row.id,
            storeMemberId: row.storeMemberId,
            userId: row.storeMember.userId,
            name: memberName(row),
            role: row.storeMember.role,
            sortOrder: row.sortOrder,
            isSelf: row.storeMember.userId === viewer.userId,
            shifts: row.shifts.map(serialiseShift),
        };
        if (!canSeePay) return { ...base, pay: null };
        const pay = buildRowPay(row, week.weekStart, published, balances.get(row.storeMemberId) ?? 0, comps);
        return { ...base, pay };
    });

    return {
        id: week.id,
        weekStart: toDateString(week.weekStart),
        dates: weekDates(week.weekStart),
        status: week.status,
        publishedAt: week.publishedAt?.toISOString() ?? null,
        canEdit: isManager(viewer),
        rows,
    };
};

// Outstanding cash advance balance per member: advances taken minus everything
// already deducted. Replaces the hand-maintained "ca bal: …" remark.
const cashAdvanceBalances = async (storeId: string): Promise<Map<string, number>> => {
    const advances = await scheduleRepository.listCashAdvances(storeId);
    const balances = new Map<string, number>();
    for (const advance of advances) {
        const deducted = advance.deductions.reduce((sum, d) => sum + toNum(d.amount), 0);
        const outstanding = toNum(advance.amount) - deducted;
        balances.set(advance.storeMemberId, (balances.get(advance.storeMemberId) ?? 0) + outstanding);
    }
    return balances;
};

// ── Service ───────────────────────────────────────────────────────────────────

export const scheduleService = {
    getWeek: async (storeId: string, weekStartStr: string, viewer: Viewer) => {
        const weekStart = assertWeekStart(weekStartStr);
        const [week, balances, viewerMember, comps] = await Promise.all([
            scheduleRepository.findWeek(storeId, weekStart),
            cashAdvanceBalances(storeId),
            scheduleRepository.findMemberByUser(storeId, viewer.userId),
            scheduleRepository.listCompensations(storeId),
        ]);
        const viewerMemberId = viewerMember?.id ?? null;

        if (!week) {
            // An unscheduled week is a valid, empty state — not a 404.
            return {
                id: null,
                weekStart: weekStartStr,
                dates: weekDates(weekStart),
                status: ScheduleWeekStatus.DRAFT,
                publishedAt: null,
                canEdit: isManager(viewer),
                viewerMemberId,
                rows: [],
            };
        }

        // Staff only ever see a published week; a draft is the owner's workspace.
        if (week.status === ScheduleWeekStatus.DRAFT && !isManager(viewer)) {
            return {
                id: week.id,
                weekStart: weekStartStr,
                dates: weekDates(weekStart),
                status: ScheduleWeekStatus.DRAFT,
                publishedAt: null,
                canEdit: false,
                viewerMemberId,
                rows: [],
            };
        }

        return { ...serialiseWeek(week, viewer, balances, comps), viewerMemberId };
    },

    listWeeks: async (storeId: string, viewer: Viewer, from?: string, to?: string, limit = 12) => {
        const weeks = await scheduleRepository.listWeeks(
            storeId,
            from ? toUtcDate(from) : undefined,
            to ? toUtcDate(to) : undefined,
            limit
        );
        return weeks
            .filter((w) => isManager(viewer) || w.status === ScheduleWeekStatus.PUBLISHED)
            .map((w) => ({
                id: w.id,
                weekStart: toDateString(w.weekStart),
                status: w.status,
                publishedAt: w.publishedAt?.toISOString() ?? null,
            }));
    },

    upsertWeek: async (
        storeId: string,
        userId: string,
        payload: {
            weekStart: string;
            rows: {
                storeMemberId: string;
                otHours: number;
                otAuto: boolean;
                remarks?: string | null;
                sortOrder: number;
                shifts: { date: string; isRestDay: boolean; startMinute?: number | null; endMinute?: number | null; presetId?: string | null }[];
            }[];
        }
    ) => {
        const weekStart = assertWeekStart(payload.weekStart);
        const validDates = new Set(weekDates(weekStart));

        const members = await scheduleRepository.listMembers(storeId);
        const memberIds = new Set(members.map((m) => m.id));

        for (const row of payload.rows) {
            if (!memberIds.has(row.storeMemberId)) {
                throw new AppError('MEMBER_NOT_FOUND', 'One of the staff members is not part of this store', 400);
            }
            for (const shift of row.shifts) {
                if (!validDates.has(shift.date)) {
                    throw new AppError('SHIFT_OUT_OF_WEEK', `Shift date ${shift.date} is outside the selected week`, 400);
                }
            }
        }

        const existing = await scheduleRepository.findWeek(storeId, weekStart);
        if (existing?.status === ScheduleWeekStatus.PUBLISHED) {
            throw new AppError(
                'WEEK_PUBLISHED',
                'This week is published. Unpublish it before making changes.',
                409
            );
        }

        await prisma.$transaction(async (tx) => {
            const week =
                existing ??
                (await tx.scheduleWeek.create({ data: { storeId, weekStart, createdById: userId } }));

            const keptRowIds: string[] = [];

            for (const row of payload.rows) {
                const saved = await tx.scheduleWeekRow.upsert({
                    where: {
                        scheduleWeekId_storeMemberId: {
                            scheduleWeekId: week.id,
                            storeMemberId: row.storeMemberId,
                        },
                    },
                    create: {
                        scheduleWeekId: week.id,
                        storeMemberId: row.storeMemberId,
                        otHours: new Prisma.Decimal(row.otHours),
                        otAuto: row.otAuto,
                        remarks: row.remarks ?? null,
                        sortOrder: row.sortOrder,
                    },
                    update: {
                        otHours: new Prisma.Decimal(row.otHours),
                        otAuto: row.otAuto,
                        remarks: row.remarks ?? null,
                        sortOrder: row.sortOrder,
                    },
                });
                keptRowIds.push(saved.id);

                // Shifts are a small fixed set (≤7); replacing them wholesale is
                // simpler and cheaper than diffing.
                await tx.scheduleShift.deleteMany({ where: { scheduleWeekRowId: saved.id } });
                if (row.shifts.length > 0) {
                    await tx.scheduleShift.createMany({
                        data: row.shifts.map((shift) => ({
                            scheduleWeekRowId: saved.id,
                            date: toUtcDate(shift.date),
                            isRestDay: shift.isRestDay,
                            startMinute: shift.isRestDay ? null : shift.startMinute ?? null,
                            endMinute: shift.isRestDay ? null : shift.endMinute ?? null,
                            presetId: shift.isRestDay ? null : shift.presetId ?? null,
                        })),
                    });
                }
            }

            // Members dropped from the grid lose their row (and its shifts).
            await tx.scheduleWeekRow.deleteMany({
                where: { scheduleWeekId: week.id, id: { notIn: keptRowIds.length > 0 ? keptRowIds : ['__none__'] } },
            });
        });

        return scheduleService.getWeek(storeId, payload.weekStart, { userId, role: Role.OWNER });
    },

    setPublished: async (storeId: string, weekStartStr: string, publish: boolean, viewer: Viewer) => {
        const weekStart = assertWeekStart(weekStartStr);
        const week = await scheduleRepository.findWeek(storeId, weekStart);
        if (!week) throw new AppError('WEEK_NOT_FOUND', 'That week has not been scheduled yet', 404);

        if (!publish) {
            // Reopening clears the frozen rates so the draft recomputes live.
            await prisma.$transaction([
                prisma.scheduleWeekRow.updateMany({
                    where: { scheduleWeekId: week.id },
                    data: { dailyRate: null, otHourlyRate: null, daysWorked: null, lessCa: null, payout: null },
                }),
                prisma.scheduleWeek.update({
                    where: { id: week.id },
                    data: { status: ScheduleWeekStatus.DRAFT, publishedAt: null },
                }),
            ]);
            return scheduleService.getWeek(storeId, weekStartStr, viewer);
        }

        // Freeze each row's rates and payout at publish time.
        const missingRates: string[] = [];
        const updates: Prisma.PrismaPromise<unknown>[] = [];
        const comps = await scheduleRepository.listCompensations(storeId);

        for (const row of week.rows) {
            const comp = compensationOn(comps, row.storeMemberId, weekStart);
            if (!comp) {
                missingRates.push(memberName(row));
                continue;
            }
            const daysWorked = countDaysWorked(row.shifts);
            const dailyRate = toNum(comp.dailyRate);
            const rowOtHourlyRate = otHourlyRateFrom(comp);
            const lessCa = row.caDeductions.reduce((sum, d) => sum + toNum(d.amount), 0);
            const otHours = row.otAuto
                ? computeOtHours(row.shifts, toNum(comp.hoursPerDay) || 8, comp.breakMinutes)
                : toNum(row.otHours);
            const payout = computePayout({
                daysWorked,
                dailyRate,
                otHours,
                otHourlyRate: rowOtHourlyRate,
                lessCa,
            });

            updates.push(
                prisma.scheduleWeekRow.update({
                    where: { id: row.id },
                    data: {
                        daysWorked,
                        otHours: new Prisma.Decimal(otHours),
                        dailyRate: new Prisma.Decimal(dailyRate),
                        otHourlyRate: new Prisma.Decimal(rowOtHourlyRate),
                        lessCa: new Prisma.Decimal(lessCa),
                        payout: new Prisma.Decimal(payout),
                    },
                })
            );
        }

        if (missingRates.length > 0) {
            throw new AppError(
                'MISSING_PAY_RATE',
                `Set a daily rate before publishing (Rates), or remove them from this week: ${missingRates.join(', ')}`,
                400,
                { members: missingRates }
            );
        }

        await prisma.$transaction([
            ...updates,
            prisma.scheduleWeek.update({
                where: { id: week.id },
                data: { status: ScheduleWeekStatus.PUBLISHED, publishedAt: new Date() },
            }),
        ]);

        return scheduleService.getWeek(storeId, weekStartStr, viewer);
    },

    // Carries shift patterns and rest days forward. OT, cash-advance deductions
    // and remarks are week-specific and deliberately not copied.
    copyWeek: async (
        storeId: string,
        userId: string,
        fromWeekStartStr: string,
        toWeekStartStr: string,
        overwrite: boolean
    ) => {
        const fromWeekStart = assertWeekStart(fromWeekStartStr);
        const toWeekStart = assertWeekStart(toWeekStartStr);
        if (fromWeekStartStr === toWeekStartStr) {
            throw new AppError('SAME_WEEK', 'Source and target weeks are the same', 400);
        }

        const source = await scheduleRepository.findWeek(storeId, fromWeekStart);
        if (!source || source.rows.length === 0) {
            throw new AppError('WEEK_NOT_FOUND', 'There is nothing to copy from that week', 404);
        }

        const target = await scheduleRepository.findWeek(storeId, toWeekStart);
        if (target?.status === ScheduleWeekStatus.PUBLISHED) {
            throw new AppError('WEEK_PUBLISHED', 'The target week is published. Unpublish it first.', 409);
        }
        if (target && target.rows.length > 0 && !overwrite) {
            throw new AppError('WEEK_NOT_EMPTY', 'The target week already has a schedule', 409, {
                requiresOverwrite: true,
            });
        }

        const dayOffset = Math.round((toWeekStart.getTime() - fromWeekStart.getTime()) / (24 * 60 * 60 * 1000));

        return scheduleService.upsertWeek(storeId, userId, {
            weekStart: toWeekStartStr,
            rows: source.rows.map((row) => ({
                storeMemberId: row.storeMemberId,
                otHours: 0,
                otAuto: true,
                remarks: null,
                sortOrder: row.sortOrder,
                shifts: row.shifts.map((shift) => ({
                    date: toDateString(addDays(shift.date, dayOffset)),
                    isRestDay: shift.isRestDay,
                    startMinute: shift.startMinute,
                    endMinute: shift.endMinute,
                    presetId: shift.presetId,
                })),
            })),
        });
    },

    // Soft-deletes an entire week. Published weeks are refused: their payout is
    // settled history, and dropping one would silently change what the month
    // totals report. Unpublish first if it really needs to go.
    deleteWeek: async (storeId: string, weekStartStr: string) => {
        const weekStart = assertWeekStart(weekStartStr);
        const week = await scheduleRepository.findWeek(storeId, weekStart);
        if (!week) throw new AppError('WEEK_NOT_FOUND', 'That week has not been scheduled yet', 404);
        if (week.status === ScheduleWeekStatus.PUBLISHED) {
            throw new AppError(
                'WEEK_PUBLISHED',
                'This week is published. Unpublish it before deleting.',
                409
            );
        }
        await scheduleRepository.softDeleteWeek(week.id);
    },

    // ── Shift presets ────────────────────────────────────────────────────────
    listPresets: (storeId: string) =>
        scheduleRepository.listPresets(storeId).then((presets) =>
            presets.map((p) => ({
                id: p.id,
                label: p.label,
                icon: p.icon,
                startMinute: p.startMinute,
                endMinute: p.endMinute,
                sortOrder: p.sortOrder,
            }))
        ),

    createPreset: (storeId: string, data: PresetData) => {
        if (data.endMinute <= data.startMinute) {
            throw new AppError('INVALID_PRESET', 'End time must be after start time', 400);
        }
        return scheduleRepository.createPreset(storeId, data);
    },

    updatePreset: async (storeId: string, presetId: string, data: PresetData) => {
        if (data.endMinute <= data.startMinute) {
            throw new AppError('INVALID_PRESET', 'End time must be after start time', 400);
        }
        const result = await scheduleRepository.updatePreset(storeId, presetId, data);
        if (result.count === 0) throw new AppError('PRESET_NOT_FOUND', 'Shift preset not found', 404);
    },

    deletePreset: async (storeId: string, presetId: string) => {
        const result = await scheduleRepository.softDeletePreset(storeId, presetId);
        if (result.count === 0) throw new AppError('PRESET_NOT_FOUND', 'Shift preset not found', 404);
    },

    // ── Pay rates ────────────────────────────────────────────────────────────
    listCompensations: async (storeId: string) => {
        const [allMembers, comps, scheduled] = await Promise.all([
            scheduleRepository.listMembers(storeId),
            scheduleRepository.listCompensations(storeId),
            scheduleRepository.listScheduledMemberIds(storeId),
        ]);
        // Schedulable staff, plus anyone already rostered. Without the second
        // clause an owner who was added to a week before they were dropped from
        // the staff list becomes unpublishable: publish demands a rate for every
        // row, but the rates list would no longer offer a way to set one.
        const rostered = new Set(scheduled.map((r) => r.storeMemberId));
        const members = allMembers.filter((m) => isSchedulableStaff(m.role) || rostered.has(m.id));
        return members.map((member) => {
            const history = comps.filter((c) => c.storeMemberId === member.id);
            const current = history.find((c) => c.effectiveTo === null) ?? history[0] ?? null;
            return {
                storeMemberId: member.id,
                userId: member.userId,
                name: member.user.fullName || member.user.email,
                role: member.role,
                current: current
                    ? {
                          dailyRate: toNum(current.dailyRate),
                          hoursPerDay: toNum(current.hoursPerDay),
                          breakMinutes: current.breakMinutes,
                          otMultiplier: toNum(current.otMultiplier),
                          otHourlyRate: otHourlyRateFrom(current),
                          effectiveFrom: toDateString(current.effectiveFrom),
                      }
                    : null,
            };
        });
    },

    // A raise opens a new row and closes the previous one — it never overwrites,
    // so published weeks keep the rate that was actually in force.
    setCompensation: async (
        storeId: string,
        storeMemberId: string,
        userId: string,
        data: { dailyRate: number; hoursPerDay: number; otMultiplier: number; breakMinutes: number; effectiveFrom: string }
    ) => {
        const member = await prisma.storeMember.findFirst({ where: { id: storeMemberId, storeId, deletedAt: null } });
        if (!member) throw new AppError('MEMBER_NOT_FOUND', 'Staff member not found in this store', 404);

        const effectiveFrom = toUtcDate(data.effectiveFrom);
        const previousDay = addDays(effectiveFrom, -1);

        return prisma.$transaction(async (tx) => {
            await tx.staffCompensation.updateMany({
                where: { storeMemberId, effectiveTo: null, effectiveFrom: { lt: effectiveFrom } },
                data: { effectiveTo: previousDay },
            });
            // Re-setting the rate for a date that already has one replaces it.
            await tx.staffCompensation.deleteMany({ where: { storeMemberId, effectiveFrom } });

            return tx.staffCompensation.create({
                data: {
                    storeId,
                    storeMemberId,
                    dailyRate: new Prisma.Decimal(data.dailyRate),
                    hoursPerDay: new Prisma.Decimal(data.hoursPerDay),
                    breakMinutes: data.breakMinutes,
                    otMultiplier: new Prisma.Decimal(data.otMultiplier),
                    effectiveFrom,
                    createdById: userId,
                },
            });
        });
    },

    // ── Cash advances ────────────────────────────────────────────────────────
    listCashAdvances: async (storeId: string, viewer: Viewer) => {
        // Staff see only their own advances; managers see the whole store.
        let scope: string[] | undefined;
        if (!isManager(viewer)) {
            const member = await scheduleRepository.findMemberByUser(storeId, viewer.userId);
            scope = member ? [member.id] : ['__none__'];
        }
        const advances = await scheduleRepository.listCashAdvances(storeId, scope);
        return advances.map((a) => {
            const deducted = a.deductions.reduce((sum, d) => sum + toNum(d.amount), 0);
            return {
                id: a.id,
                storeMemberId: a.storeMemberId,
                amount: toNum(a.amount),
                deducted,
                balance: toNum(a.amount) - deducted,
                takenOn: toDateString(a.takenOn),
                note: a.note,
            };
        });
    },

    createCashAdvance: async (
        storeId: string,
        userId: string,
        data: { storeMemberId: string; amount: number; takenOn: string; note?: string | null }
    ) => {
        const member = await prisma.storeMember.findFirst({
            where: { id: data.storeMemberId, storeId, deletedAt: null },
        });
        if (!member) throw new AppError('MEMBER_NOT_FOUND', 'Staff member not found in this store', 404);

        return scheduleRepository.createCashAdvance(storeId, {
            storeMemberId: data.storeMemberId,
            amount: new Prisma.Decimal(data.amount),
            takenOn: toUtcDate(data.takenOn),
            note: data.note ?? null,
            createdById: userId,
        });
    },

    deleteCashAdvance: async (storeId: string, cashAdvanceId: string) => {
        const deductions = await prisma.cashAdvanceDeduction.count({ where: { cashAdvanceId } });
        if (deductions > 0) {
            throw new AppError(
                'CASH_ADVANCE_IN_USE',
                'This advance already has deductions against it and cannot be removed',
                409
            );
        }
        const result = await scheduleRepository.softDeleteCashAdvance(storeId, cashAdvanceId);
        if (result.count === 0) throw new AppError('CASH_ADVANCE_NOT_FOUND', 'Cash advance not found', 404);
    },

    // Records this week's deduction against a specific advance. A skipped week is
    // stored as amount 0 with a reason so the decision stays visible.
    setDeduction: async (
        storeId: string,
        rowId: string,
        data: { cashAdvanceId: string; amount: number; skipped: boolean; reason?: string | null }
    ) => {
        const row = await prisma.scheduleWeekRow.findFirst({
            where: { id: rowId, scheduleWeek: { storeId, deletedAt: null } },
            include: { scheduleWeek: true },
        });
        if (!row) throw new AppError('ROW_NOT_FOUND', 'Schedule row not found', 404);
        if (row.scheduleWeek.status === ScheduleWeekStatus.PUBLISHED) {
            throw new AppError('WEEK_PUBLISHED', 'This week is published. Unpublish it before making changes.', 409);
        }

        const advance = await prisma.cashAdvance.findFirst({
            where: { id: data.cashAdvanceId, storeId, deletedAt: null },
            include: { deductions: { where: { NOT: { scheduleWeekRowId: rowId } } } },
        });
        if (!advance) throw new AppError('CASH_ADVANCE_NOT_FOUND', 'Cash advance not found', 404);

        const amount = data.skipped ? 0 : data.amount;
        const alreadyDeducted = advance.deductions.reduce((sum, d) => sum + toNum(d.amount), 0);
        const remaining = toNum(advance.amount) - alreadyDeducted;
        if (amount > remaining) {
            throw new AppError(
                'DEDUCTION_EXCEEDS_BALANCE',
                `That deduction is more than the outstanding balance (${remaining})`,
                400,
                { remaining }
            );
        }

        const saved = await prisma.cashAdvanceDeduction.upsert({
            where: {
                cashAdvanceId_scheduleWeekRowId: { cashAdvanceId: data.cashAdvanceId, scheduleWeekRowId: rowId },
            },
            create: {
                cashAdvanceId: data.cashAdvanceId,
                scheduleWeekRowId: rowId,
                amount: new Prisma.Decimal(amount),
                skipped: data.skipped,
                reason: data.reason ?? null,
            },
            update: {
                amount: new Prisma.Decimal(amount),
                skipped: data.skipped,
                reason: data.reason ?? null,
            },
        });

        // Serialised in the same shape as the deductions on a week row, so the
        // client can fold it straight into the grid instead of refetching.
        return {
            id: saved.id,
            cashAdvanceId: saved.cashAdvanceId,
            amount: toNum(saved.amount),
            skipped: saved.skipped,
            reason: saved.reason,
        };
    },

    removeDeduction: async (storeId: string, rowId: string, deductionId: string) => {
        const result = await prisma.cashAdvanceDeduction.deleteMany({
            where: {
                id: deductionId,
                scheduleWeekRowId: rowId,
                scheduleWeekRow: { scheduleWeek: { storeId, status: ScheduleWeekStatus.DRAFT } },
            },
        });
        if (result.count === 0) {
            throw new AppError('DEDUCTION_NOT_FOUND', 'Deduction not found, or its week is published', 404);
        }
    },

    // ── Month views ──────────────────────────────────────────────────────────
    //
    // A week is attributed whole to the month containing its Sunday. Payout is
    // computed per week and cannot be split across a month boundary — you can't
    // half-pay a week's OT — so proration would be wrong, not just harder.
    //
    // Only PUBLISHED weeks count toward the totals: a draft's payout isn't
    // final. Any drafts in range are reported separately so the UI can say so
    // rather than quietly under-reporting.
    monthSummary: async (storeId: string, year: number, month: number, viewer: Viewer) => {
        const from = new Date(Date.UTC(year, month - 1, 1));
        const to = new Date(Date.UTC(year, month, 0));

        const [weeks, comps, balances] = await Promise.all([
            scheduleRepository.listWeeksInRange(storeId, from, to),
            scheduleRepository.listCompensations(storeId),
            cashAdvanceBalances(storeId),
        ]);

        const published = weeks.filter((w) => w.status === ScheduleWeekStatus.PUBLISHED);
        const draftWeeks = weeks.length - published.length;

        type Totals = {
            storeMemberId: string;
            name: string;
            role: string;
            userId: string;
            isSelf: boolean;
            daysWorked: number;
            otHours: number;
            lessCa: number;
            payout: number;
            caBalance: number;
            weeks: { weekStart: string; daysWorked: number; otHours: number; lessCa: number; payout: number }[];
        };

        const totals = new Map<string, Totals>();

        for (const week of published) {
            for (const row of week.rows) {
                const pay = buildRowPay(row, week.weekStart, true, 0, comps);
                let entry = totals.get(row.storeMemberId);
                if (!entry) {
                    entry = {
                        storeMemberId: row.storeMemberId,
                        name: memberName(row),
                        role: row.storeMember.role,
                        userId: row.storeMember.userId,
                        isSelf: row.storeMember.userId === viewer.userId,
                        daysWorked: 0,
                        otHours: 0,
                        lessCa: 0,
                        payout: 0,
                        caBalance: balances.get(row.storeMemberId) ?? 0,
                        weeks: [],
                    };
                    totals.set(row.storeMemberId, entry);
                }
                entry.daysWorked += pay.daysWorked;
                entry.otHours += pay.otHours;
                entry.lessCa += pay.lessCa;
                entry.payout += pay.payout;
                entry.weeks.push({
                    weekStart: toDateString(week.weekStart),
                    daysWorked: pay.daysWorked,
                    otHours: pay.otHours,
                    lessCa: pay.lessCa,
                    payout: pay.payout,
                });
            }
        }

        // Same masking rule as the week grid: staff see only their own totals.
        const rows = [...totals.values()]
            .filter((t) => isManager(viewer) || t.isSelf)
            .sort((a, b) => a.name.localeCompare(b.name));

        return {
            year,
            month,
            weekCount: published.length,
            draftWeeks,
            rows,
            grandTotal: rows.reduce(
                (acc, r) => ({
                    daysWorked: acc.daysWorked + r.daysWorked,
                    otHours: acc.otHours + r.otHours,
                    lessCa: acc.lessCa + r.lessCa,
                    payout: acc.payout + r.payout,
                }),
                { daysWorked: 0, otHours: 0, lessCa: 0, payout: 0 }
            ),
        };
    },

    // One member's shifts across a month, for the calendar view. Staff may only
    // request their own, and never see an unpublished week.
    memberMonth: async (storeId: string, storeMemberId: string, year: number, month: number, viewer: Viewer) => {
        const member = await prisma.storeMember.findFirst({
            where: { id: storeMemberId, storeId, deletedAt: null },
            include: { user: { select: { fullName: true, email: true } } },
        });
        if (!member) throw new AppError('MEMBER_NOT_FOUND', 'Staff member not found in this store', 404);
        if (!isManager(viewer) && member.userId !== viewer.userId) {
            throw new AppError('FORBIDDEN', 'You can only view your own calendar', 403);
        }

        const from = new Date(Date.UTC(year, month - 1, 1));
        const to = new Date(Date.UTC(year, month, 0));
        const shifts = await scheduleRepository.listMemberShifts(storeId, storeMemberId, from, to);

        const visible = shifts.filter(
            (s) => isManager(viewer) || s.scheduleWeekRow.scheduleWeek.status === ScheduleWeekStatus.PUBLISHED
        );

        return {
            year,
            month,
            storeMemberId,
            name: member.user.fullName || member.user.email,
            days: visible.map((s) => ({
                date: toDateString(s.date),
                isRestDay: s.isRestDay,
                startMinute: s.startMinute,
                endMinute: s.endMinute,
                icon: s.preset?.icon ?? 'none',
                presetLabel: s.preset?.label ?? null,
                isDraft: s.scheduleWeekRow.scheduleWeek.status === ScheduleWeekStatus.DRAFT,
            })),
        };
    },

    // Every week block of a month on one page, matching the stacked layout of
    // the spreadsheet this replaces. Read-only — publish, rate-freezing and CA
    // deductions are all per-week operations, so editing stays on the Week tab.
    //
    // Weeks with no schedule yet are returned as empty blocks rather than
    // omitted, so a gap in the month is visible instead of silently absent.
    stackedMonth: async (storeId: string, year: number, month: number, viewer: Viewer) => {
        const monthStart = new Date(Date.UTC(year, month - 1, 1));
        const monthEnd = new Date(Date.UTC(year, month, 0));

        // Every Sunday falling inside the month — same attribution rule as the
        // totals view, so the two never disagree about which weeks belong here.
        const sundays: Date[] = [];
        const cursor = new Date(monthStart);
        cursor.setUTCDate(cursor.getUTCDate() + ((7 - cursor.getUTCDay()) % 7));
        while (cursor <= monthEnd) {
            sundays.push(new Date(cursor));
            cursor.setUTCDate(cursor.getUTCDate() + 7);
        }

        const [weeks, comps, balances, viewerMember] = await Promise.all([
            scheduleRepository.listWeeksInRange(storeId, monthStart, monthEnd),
            scheduleRepository.listCompensations(storeId),
            cashAdvanceBalances(storeId),
            scheduleRepository.findMemberByUser(storeId, viewer.userId),
        ]);

        const byWeekStart = new Map(weeks.map((w) => [toDateString(w.weekStart), w]));

        const blocks = sundays.map((sunday) => {
            const key = toDateString(sunday);
            const week = byWeekStart.get(key);

            // Staff never see a draft's contents — same rule as the week view.
            const hidden = !week || (week.status === ScheduleWeekStatus.DRAFT && !isManager(viewer));
            if (hidden) {
                return {
                    id: week?.id ?? null,
                    weekStart: key,
                    dates: weekDates(sunday),
                    status: week?.status ?? ScheduleWeekStatus.DRAFT,
                    publishedAt: null,
                    canEdit: false,
                    rows: [],
                    // Distinguishes "nothing scheduled" from "scheduled but not
                    // published yet" so the UI can word the empty state right.
                    isUnscheduled: !week,
                };
            }

            return { ...serialiseWeek(week, viewer, balances, comps), isUnscheduled: false };
        });

        return {
            year,
            month,
            viewerMemberId: viewerMember?.id ?? null,
            canEdit: isManager(viewer),
            weeks: blocks,
        };
    },

    listMembers: (storeId: string) =>
        scheduleRepository.listMembers(storeId).then((members) =>
            members
                .filter((m) => isSchedulableStaff(m.role))
                .map((m) => ({
                    storeMemberId: m.id,
                    userId: m.userId,
                    name: m.user.fullName || m.user.email,
                    role: m.role,
                }))
        ),
};
