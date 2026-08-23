import { Role, TimeEntrySource } from '@prisma/client';
import { AppError } from '../../shared/errors';
import { toZonedDateString, zonedStartOfDay } from '../../shared/datetime';
import { RangeShiftRow, scheduleRepository, TimeEntryRow } from './schedule.repository';
import { compensationOn } from './schedule.payroll';
import { ClockPair, DayReconciliation, reconcileDay, ShiftPlan, sumWeek, toHours } from './schedule.attendance';
import { isSchedulableStaff, Viewer } from './schedule.service';

// Tolerance before a punch is badged late/early. Zero keeps the badge honest —
// the owner reconciles payroll from these numbers, so a 3-minute late punch
// should say so. Becomes a store setting the day someone asks for one.
const GRACE_MINUTES = 0;

// Widest window the attendance grid may request at once. The month view asks
// for ~31 days; this is headroom, not a target.
const MAX_RANGE_DAYS = 62;

const MANAGER_ROLES: Role[] = [Role.OWNER, Role.ADMIN];
const isManager = (viewer: Viewer) => MANAGER_ROLES.includes(viewer.role);

// Date-only columns are stored at UTC midnight, matching the rest of the module.
const toUtcDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const toDateString = (date: Date): string => date.toISOString().slice(0, 10);
const shiftDays = (value: string, days: number): string =>
    toDateString(new Date(toUtcDate(value).getTime() + days * 86400000));

const dateRange = (from: string, to: string): string[] => {
    const days: string[] = [];
    for (let cursor = from; cursor <= to; cursor = shiftDays(cursor, 1)) {
        days.push(cursor);
        if (days.length > MAX_RANGE_DAYS) break;
    }
    return days;
};

// Minutes from local midnight of `workDate`. Deliberately allowed to exceed
// 1440: a punch-out at 1AM on an overnight shift is minute 1500 of the day it
// started, which is the same axis the roster's endMinute already uses.
const minutesFromDayStart = (instant: Date, workDate: string, timeZone: string): number =>
    Math.round((instant.getTime() - zonedStartOfDay(workDate, timeZone).getTime()) / 60000);

const instantFromMinutes = (workDate: string, minute: number, timeZone: string): Date =>
    new Date(zonedStartOfDay(workDate, timeZone).getTime() + minute * 60000);

const storeTimezone = async (storeId: string): Promise<string> => {
    const store = await scheduleRepository.findStoreTimezone(storeId);
    if (!store) throw new AppError('STORE_NOT_FOUND', 'Store not found', 404);
    return store.timezone;
};

const requireMember = async (storeId: string, userId: string) => {
    const member = await scheduleRepository.findMemberByUser(storeId, userId);
    if (!member) throw new AppError('MEMBER_NOT_FOUND', 'You are not a member of this store', 403);
    return member;
};

const isWorkingShift = (shift: ShiftPlan) =>
    shift !== null && !shift.isRestDay && shift.startMinute !== null && shift.endMinute !== null;

const shiftKey = (storeMemberId: string, date: string) => `${storeMemberId}|${date}`;

const toShiftPlan = (shift: RangeShiftRow | undefined): ShiftPlan =>
    shift ? { isRestDay: shift.isRestDay, startMinute: shift.startMinute, endMinute: shift.endMinute } : null;

const serialiseEntry = (entry: TimeEntryRow, timeZone: string) => {
    const workDate = toDateString(entry.workDate);
    return {
        id: entry.id,
        storeMemberId: entry.storeMemberId,
        workDate,
        clockInAt: entry.clockInAt.toISOString(),
        clockOutAt: entry.clockOutAt?.toISOString() ?? null,
        inMinute: minutesFromDayStart(entry.clockInAt, workDate, timeZone),
        outMinute: entry.clockOutAt ? minutesFromDayStart(entry.clockOutAt, workDate, timeZone) : null,
        source: entry.source,
        note: entry.note,
        editedBy: entry.editedBy ? entry.editedBy.fullName || entry.editedBy.email : null,
        editedAt: entry.editedAt?.toISOString() ?? null,
    };
};

type SerialisedEntry = ReturnType<typeof serialiseEntry>;

const toClockPairs = (entries: SerialisedEntry[]): ClockPair[] =>
    entries.map((e) => ({ inMinute: e.inMinute, outMinute: e.outMinute }));

// The work day a punch made *now* belongs to. Usually today, but an overnight
// shift that started yesterday is still yesterday's shift at 1AM — attributing
// that punch to today would strand it as unscheduled and split the pair across
// two days.
const resolveWorkDate = (
    now: Date,
    timeZone: string,
    shiftFor: (date: string) => ShiftPlan,
    hasClosedEntryOn: (date: string) => boolean
): string => {
    const today = toZonedDateString(now, timeZone);
    const yesterday = shiftDays(today, -1);
    const overnight = shiftFor(yesterday);

    if (
        isWorkingShift(overnight) &&
        (overnight as { endMinute: number }).endMinute > 1440 &&
        // Already punched out yesterday — this is a fresh day, not a late start.
        !hasClosedEntryOn(yesterday)
    ) {
        const minute = minutesFromDayStart(now, yesterday, timeZone);
        const { startMinute, endMinute } = overnight as { startMinute: number; endMinute: number };
        if (minute >= startMinute && minute <= endMinute) return yesterday;
    }

    return today;
};

export const attendanceService = {
    // What the Time In/Out button renders: the viewer's open punch (if any),
    // today's rostered shift, and today's running reconciliation.
    current: async (storeId: string, viewer: Viewer) => {
        const [timeZone, member] = await Promise.all([storeTimezone(storeId), requireMember(storeId, viewer.userId)]);
        const now = new Date();
        const today = toZonedDateString(now, timeZone);
        const yesterday = shiftDays(today, -1);

        const [shifts, entries, comps] = await Promise.all([
            scheduleRepository.listMemberShifts(storeId, member.id, toUtcDate(yesterday), toUtcDate(today)),
            scheduleRepository.listTimeEntries(storeId, toUtcDate(yesterday), toUtcDate(today), [member.id]),
            scheduleRepository.listCompensations(storeId),
        ]);

        const shiftByDate = new Map(shifts.map((s) => [toDateString(s.date), s]));
        const open = entries.find((e) => e.clockOutAt === null) ?? null;

        // An open punch anchors the view to its own work day; otherwise the
        // button is about today (or last night's shift still in progress).
        const workDate = open
            ? toDateString(open.workDate)
            : resolveWorkDate(
                  now,
                  timeZone,
                  (date) => toShiftPlan(shiftByDate.get(date) as RangeShiftRow | undefined),
                  (date) => entries.some((e) => toDateString(e.workDate) === date && e.clockOutAt !== null)
              );

        const shift = shiftByDate.get(workDate);
        const dayEntries = entries
            .filter((e) => toDateString(e.workDate) === workDate)
            .map((e) => serialiseEntry(e, timeZone));
        const comp = compensationOn(comps, member.id, toUtcDate(workDate));

        const reconciliation = reconcileDay(toShiftPlan(shift as RangeShiftRow | undefined), toClockPairs(dayEntries), {
            breakMinutes: comp?.breakMinutes ?? 0,
            graceMinutes: GRACE_MINUTES,
            dayIsOver: false,
        });

        return {
            storeMemberId: member.id,
            timeZone,
            workDate,
            serverTime: now.toISOString(),
            // Non-null exactly when the viewer is clocked in, which is what the
            // button toggles on.
            openEntry: open ? serialiseEntry(open, timeZone) : null,
            shift: shift
                ? {
                      isRestDay: shift.isRestDay,
                      startMinute: shift.startMinute,
                      endMinute: shift.endMinute,
                      icon: shift.preset?.icon ?? 'none',
                      presetLabel: shift.preset?.label ?? null,
                      isDraft: shift.scheduleWeekRow.scheduleWeek.status === 'DRAFT',
                  }
                : null,
            entries: dayEntries,
            reconciliation,
        };
    },

    clockIn: async (storeId: string, viewer: Viewer, note?: string | null) => {
        const [timeZone, member] = await Promise.all([storeTimezone(storeId), requireMember(storeId, viewer.userId)]);
        const now = new Date();
        const today = toZonedDateString(now, timeZone);
        const yesterday = shiftDays(today, -1);

        const [shifts, entries] = await Promise.all([
            scheduleRepository.listMemberShifts(storeId, member.id, toUtcDate(yesterday), toUtcDate(today)),
            scheduleRepository.listTimeEntries(storeId, toUtcDate(yesterday), toUtcDate(today), [member.id]),
        ]);
        const shiftByDate = new Map(shifts.map((s) => [toDateString(s.date), s]));

        const workDate = resolveWorkDate(
            now,
            timeZone,
            (date) => toShiftPlan(shiftByDate.get(date) as RangeShiftRow | undefined),
            (date) => entries.some((e) => toDateString(e.workDate) === date && e.clockOutAt !== null)
        );

        const shift = shiftByDate.get(workDate);
        const created = await scheduleRepository.createTimeEntryIfIdle({
            storeId,
            storeMemberId: member.id,
            workDate: toUtcDate(workDate),
            clockInAt: now,
            // Frozen at clock-in: re-deriving it later would move a punch onto a
            // shift the member never worked if the roster is edited afterwards.
            scheduleShiftId: shift && !shift.isRestDay ? shift.id : null,
            source: TimeEntrySource.SELF,
            note: note ?? null,
        });
        if (!created) {
            throw new AppError('ALREADY_CLOCKED_IN', 'You are already timed in — time out first', 409);
        }

        return attendanceService.current(storeId, viewer);
    },

    clockOut: async (storeId: string, viewer: Viewer, note?: string | null) => {
        const member = await requireMember(storeId, viewer.userId);
        const open = await scheduleRepository.findOpenTimeEntry(storeId, member.id);
        if (!open) throw new AppError('NOT_CLOCKED_IN', 'You are not timed in', 409);

        const now = new Date();
        if (now <= open.clockInAt) {
            throw new AppError('INVALID_CLOCK_OUT', 'Time out cannot be before time in', 400);
        }

        await scheduleRepository.updateTimeEntry(open.id, {
            clockOutAt: now,
            // Appending keeps a time-in note from being silently replaced.
            note: note ? [open.note, note].filter(Boolean).join(' · ') : open.note,
        });

        return attendanceService.current(storeId, viewer);
    },

    // The Attendance tab: every rostered day in the range beside what was
    // actually punched, per member.
    list: async (
        storeId: string,
        viewer: Viewer,
        from: string,
        to: string,
        storeMemberId?: string
    ) => {
        if (to < from) throw new AppError('INVALID_RANGE', 'End date must not precede start date', 400);
        const days = dateRange(from, to);
        if (days.length > MAX_RANGE_DAYS) {
            throw new AppError('RANGE_TOO_WIDE', `Range is limited to ${MAX_RANGE_DAYS} days`, 400);
        }

        const [timeZone, viewerMember, members, comps] = await Promise.all([
            storeTimezone(storeId),
            scheduleRepository.findMemberByUser(storeId, viewer.userId),
            scheduleRepository.listMembers(storeId),
            scheduleRepository.listCompensations(storeId),
        ]);

        // Attendance is pay-adjacent, so staff see only their own row — unlike
        // the roster, which everyone reads in full to coordinate swaps.
        if (!isManager(viewer)) {
            if (!viewerMember) throw new AppError('MEMBER_NOT_FOUND', 'You are not a member of this store', 403);
            if (storeMemberId && storeMemberId !== viewerMember.id) {
                throw new AppError('FORBIDDEN', 'You can only view your own attendance', 403);
            }
        }

        const targets = members.filter((m) => {
            // The owner runs the store rather than working a rostered shift, so
            // they stay out of the grid — the same rule the roster and the
            // pay-rate list use.
            if (!isSchedulableStaff(m.role)) return false;
            if (!isManager(viewer)) return m.id === viewerMember?.id;
            return storeMemberId ? m.id === storeMemberId : true;
        });
        const targetIds = targets.map((m) => m.id);

        const [shifts, entries] = await Promise.all([
            scheduleRepository.listShiftsInRange(storeId, toUtcDate(from), toUtcDate(to)),
            targetIds.length > 0
                ? scheduleRepository.listTimeEntries(storeId, toUtcDate(from), toUtcDate(to), targetIds)
                : Promise.resolve([] as TimeEntryRow[]),
        ]);

        const shiftMap = new Map<string, RangeShiftRow>();
        for (const shift of shifts) {
            shiftMap.set(shiftKey(shift.scheduleWeekRow.storeMemberId, toDateString(shift.date)), shift);
        }

        const entryMap = new Map<string, SerialisedEntry[]>();
        for (const entry of entries) {
            const key = shiftKey(entry.storeMemberId, toDateString(entry.workDate));
            const list = entryMap.get(key) ?? [];
            list.push(serialiseEntry(entry, timeZone));
            entryMap.set(key, list);
        }

        const today = toZonedDateString(new Date(), timeZone);

        const rows = targets.map((member) => {
            const reconciliations: DayReconciliation[] = [];
            const memberDays = days.map((date) => {
                const key = shiftKey(member.id, date);
                const shift = shiftMap.get(key);
                const dayEntries = entryMap.get(key) ?? [];
                // A draft week is the owner's workspace; staff must not read it
                // here any more than they can on the grid.
                const hidden = Boolean(shift) && !isManager(viewer) && shift?.scheduleWeekRow.scheduleWeek.status === 'DRAFT';
                const plan = hidden ? null : toShiftPlan(shift);
                const comp = compensationOn(comps, member.id, toUtcDate(date));

                const reconciliation = reconcileDay(plan, toClockPairs(dayEntries), {
                    breakMinutes: comp?.breakMinutes ?? 0,
                    graceMinutes: GRACE_MINUTES,
                    dayIsOver: date < today,
                });
                reconciliations.push(reconciliation);

                return {
                    date,
                    shift: plan
                        ? {
                              isRestDay: plan.isRestDay,
                              startMinute: plan.startMinute,
                              endMinute: plan.endMinute,
                              icon: shift?.preset?.icon ?? 'none',
                              presetLabel: shift?.preset?.label ?? null,
                          }
                        : null,
                    // Distinguishes "no shift" from "shift exists but unpublished",
                    // so the UI never labels an unpublished day as unscheduled.
                    scheduleHidden: hidden,
                    entries: dayEntries,
                    ...reconciliation,
                };
            });

            const totals = sumWeek(reconciliations);
            return {
                storeMemberId: member.id,
                userId: member.userId,
                name: member.user.fullName || member.user.email,
                role: member.role,
                isSelf: member.userId === viewer.userId,
                days: memberDays,
                totals: {
                    ...totals,
                    scheduledHours: toHours(totals.scheduledMinutes),
                    actualHours: toHours(totals.actualMinutes),
                    varianceHours: toHours(totals.varianceMinutes),
                },
            };
        });

        return { from, to, timeZone, canEdit: isManager(viewer), viewerMemberId: viewerMember?.id ?? null, rows };
    },

    // Manager correction — a forgotten punch, or a punch-out that never happened.
    upsertEntry: async (
        storeId: string,
        viewer: Viewer,
        payload: {
            entryId?: string;
            storeMemberId: string;
            workDate: string;
            clockInMinute: number;
            clockOutMinute: number | null;
            note?: string | null;
        }
    ) => {
        const timeZone = await storeTimezone(storeId);
        const member = (await scheduleRepository.listMembers(storeId)).find((m) => m.id === payload.storeMemberId);
        if (!member) throw new AppError('MEMBER_NOT_FOUND', 'Staff member not found in this store', 404);

        if (payload.clockOutMinute !== null && payload.clockOutMinute <= payload.clockInMinute) {
            throw new AppError('INVALID_CLOCK_OUT', 'Time out must be after time in', 400);
        }

        const clockInAt = instantFromMinutes(payload.workDate, payload.clockInMinute, timeZone);
        const clockOutAt =
            payload.clockOutMinute === null ? null : instantFromMinutes(payload.workDate, payload.clockOutMinute, timeZone);

        // Overlap check within the day, so a correction cannot double-count the
        // same hours as an existing punch.
        const sameDay = await scheduleRepository.listTimeEntries(
            storeId,
            toUtcDate(payload.workDate),
            toUtcDate(payload.workDate),
            [payload.storeMemberId]
        );
        const overlaps = sameDay.some((existing) => {
            if (existing.id === payload.entryId) return false;
            const existingOut = existing.clockOutAt ?? new Date(8640000000000000);
            const newOut = clockOutAt ?? new Date(8640000000000000);
            return existing.clockInAt < newOut && clockInAt < existingOut;
        });
        if (overlaps) {
            throw new AppError('OVERLAPPING_ENTRY', 'This overlaps an existing entry for that day', 409);
        }

        if (payload.entryId) {
            const existing = await scheduleRepository.findTimeEntry(storeId, payload.entryId);
            if (!existing) throw new AppError('ENTRY_NOT_FOUND', 'Time entry not found', 404);
            await scheduleRepository.updateTimeEntry(existing.id, {
                clockInAt,
                clockOutAt,
                note: payload.note ?? null,
                editedById: viewer.userId,
                editedAt: new Date(),
            });
            return { id: existing.id };
        }

        const shifts = await scheduleRepository.listMemberShifts(
            storeId,
            payload.storeMemberId,
            toUtcDate(payload.workDate),
            toUtcDate(payload.workDate)
        );
        const shift = shifts.find((s) => !s.isRestDay) ?? null;

        const created = await scheduleRepository.createTimeEntry({
            storeId,
            storeMemberId: payload.storeMemberId,
            workDate: toUtcDate(payload.workDate),
            clockInAt,
            clockOutAt,
            scheduleShiftId: shift?.id ?? null,
            source: TimeEntrySource.MANAGER,
            note: payload.note ?? null,
            editedById: viewer.userId,
            editedAt: new Date(),
        });
        return { id: created.id };
    },

    deleteEntry: async (storeId: string, entryId: string) => {
        const deleted = await scheduleRepository.softDeleteTimeEntry(storeId, entryId);
        if (deleted.count === 0) throw new AppError('ENTRY_NOT_FOUND', 'Time entry not found', 404);
    },
};
