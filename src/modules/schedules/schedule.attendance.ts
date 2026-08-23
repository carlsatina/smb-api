// Pure attendance maths, kept free of Prisma so it can be unit-tested directly
// (same split as ./schedule.payroll).
//
// The roster says what was *planned*; a TimeEntry says what *happened*.
// Reconciliation is the comparison, expressed in minutes past the shift's own
// local midnight so an overnight shift (endMinute > 1440) and a punch made
// after midnight land on the same axis.

export type ClockPair = {
    // Minutes from local midnight of the entry's workDate. `out` is null while
    // the member is still clocked in; it may exceed 1440 for an overnight shift.
    inMinute: number;
    outMinute: number | null;
};

export type ShiftPlan = {
    isRestDay: boolean;
    startMinute: number | null;
    endMinute: number | null;
} | null;

export type DayStatus =
    | 'OPEN' // clocked in, not yet out
    | 'ABSENT' // rostered to work, day is over, never punched
    | 'SCHEDULED' // rostered to work, day not over yet, no punch
    | 'UNSCHEDULED' // punched on a rest day or a day with no roster entry
    | 'LATE'
    | 'UNDERTIME'
    | 'OVERTIME'
    | 'ON_TIME'
    | 'REST_DAY'; // rest day, nothing punched

export type DayReconciliation = {
    scheduledMinutes: number;
    actualMinutes: number;
    lateMinutes: number;
    earlyOutMinutes: number;
    overtimeMinutes: number;
    // actual − scheduled. Negative is undertime, positive is time beyond the roster.
    varianceMinutes: number;
    isOpen: boolean;
    status: DayStatus;
};

export type ReconcileOptions = {
    // Unpaid break, deducted once per worked day from both sides so scheduled
    // and actual are measured on the same basis (see schedule.payroll).
    breakMinutes?: number;
    // Tolerance before a punch counts as late / early / overtime. A minute or
    // two either side of the shift is noise, not a payroll event.
    graceMinutes?: number;
    // Whether the work day has finished in the store's timezone. Passed in
    // rather than read from the clock so this module stays deterministic.
    dayIsOver?: boolean;
};

const isWorkingShift = (shift: ShiftPlan): shift is { isRestDay: false; startMinute: number; endMinute: number } =>
    shift !== null && !shift.isRestDay && shift.startMinute !== null && shift.endMinute !== null;

// Scheduled span for one day, less the unpaid break. A 9AM-6PM shift with a
// 1-hour break is exactly one 8-hour day, matching computeOtHours.
export const plannedMinutes = (shift: ShiftPlan, breakMinutes = 0): number => {
    if (!isWorkingShift(shift)) return 0;
    return Math.max(0, shift.endMinute - shift.startMinute - Math.max(0, breakMinutes));
};

// Time actually on the clock. Open entries contribute nothing — a shift still
// in progress has no worked total yet, and guessing one would quietly inflate
// the week whenever someone forgets to punch out.
export const punchedMinutes = (entries: ClockPair[], breakMinutes = 0): number => {
    const closed = entries.filter((e) => e.outMinute !== null);
    if (closed.length === 0) return 0;
    const raw = closed.reduce((total, e) => total + Math.max(0, (e.outMinute as number) - e.inMinute), 0);
    return Math.max(0, raw - Math.max(0, breakMinutes));
};

// Split shifts are legal, so the day is bounded by the first punch in and the
// last punch out rather than by a single pair.
const firstIn = (entries: ClockPair[]): number | null =>
    entries.length === 0 ? null : Math.min(...entries.map((e) => e.inMinute));

const lastOut = (entries: ClockPair[]): number | null => {
    const closed = entries.filter((e) => e.outMinute !== null).map((e) => e.outMinute as number);
    return closed.length === 0 ? null : Math.max(...closed);
};

export const reconcileDay = (
    shift: ShiftPlan,
    entries: ClockPair[],
    { breakMinutes = 0, graceMinutes = 0, dayIsOver = false }: ReconcileOptions = {}
): DayReconciliation => {
    const grace = Math.max(0, graceMinutes);
    const scheduledMinutes = plannedMinutes(shift, breakMinutes);
    const actualMinutes = punchedMinutes(entries, breakMinutes);
    const isOpen = entries.some((e) => e.outMinute === null);

    const start = isWorkingShift(shift) ? shift.startMinute : null;
    const end = isWorkingShift(shift) ? shift.endMinute : null;
    const inAt = firstIn(entries);
    const outAt = lastOut(entries);

    const lateMinutes = start !== null && inAt !== null ? Math.max(0, inAt - start - grace) : 0;
    const earlyOutMinutes = end !== null && outAt !== null ? Math.max(0, end - outAt - grace) : 0;
    const overtimeMinutes = end !== null && outAt !== null ? Math.max(0, outAt - end - grace) : 0;

    // Only meaningful once the day has a roster and a completed punch; an
    // unscheduled day has nothing to vary from.
    const varianceMinutes = actualMinutes - scheduledMinutes;

    const status = ((): DayStatus => {
        if (isOpen) return 'OPEN';
        if (entries.length === 0) {
            if (isWorkingShift(shift)) return dayIsOver ? 'ABSENT' : 'SCHEDULED';
            return 'REST_DAY';
        }
        // Punched without a working shift on the roster — reported, never
        // rejected: the roster is often filled in after the fact.
        if (!isWorkingShift(shift)) return 'UNSCHEDULED';
        if (lateMinutes > 0) return 'LATE';
        if (earlyOutMinutes > 0 || varianceMinutes < -grace) return 'UNDERTIME';
        if (overtimeMinutes > 0 || varianceMinutes > grace) return 'OVERTIME';
        return 'ON_TIME';
    })();

    return {
        scheduledMinutes,
        actualMinutes,
        lateMinutes,
        earlyOutMinutes,
        overtimeMinutes,
        varianceMinutes,
        isOpen,
        status,
    };
};

export type WeekTotals = {
    scheduledMinutes: number;
    actualMinutes: number;
    lateMinutes: number;
    varianceMinutes: number;
    daysWorked: number;
    daysAbsent: number;
    openDays: number;
};

// Week roll-up for the payout screen. `daysWorked` counts days with a completed
// punch, which is what the owner reconciles against the roster's day count —
// it is a suggestion, never a replacement for the stored figure.
export const sumWeek = (days: DayReconciliation[]): WeekTotals =>
    days.reduce<WeekTotals>(
        (totals, day) => ({
            scheduledMinutes: totals.scheduledMinutes + day.scheduledMinutes,
            actualMinutes: totals.actualMinutes + day.actualMinutes,
            lateMinutes: totals.lateMinutes + day.lateMinutes,
            varianceMinutes: totals.varianceMinutes + (day.actualMinutes - day.scheduledMinutes),
            daysWorked: totals.daysWorked + (day.actualMinutes > 0 ? 1 : 0),
            daysAbsent: totals.daysAbsent + (day.status === 'ABSENT' ? 1 : 0),
            openDays: totals.openDays + (day.isOpen ? 1 : 0),
        }),
        {
            scheduledMinutes: 0,
            actualMinutes: 0,
            lateMinutes: 0,
            varianceMinutes: 0,
            daysWorked: 0,
            daysAbsent: 0,
            openDays: 0,
        }
    );

// Hours to 2dp, the unit the payout screen and OT column speak in.
export const toHours = (minutes: number): number => Math.round((minutes / 60) * 100) / 100;

// OT implied by what was actually punched, on the same basis as computeOtHours:
// paid minutes beyond a regular day, per day worked. A *suggestion* for the
// owner — OT stays a manual field, because identical patterns legitimately
// carry different OT (see schedule.payroll).
export const otHoursFromActual = (actualMinutes: number, daysWorked: number, hoursPerDay: number): number => {
    const regularMinutes = daysWorked * (hoursPerDay || 8) * 60;
    const over = actualMinutes - regularMinutes;
    return over > 0 ? toHours(over) : 0;
};
