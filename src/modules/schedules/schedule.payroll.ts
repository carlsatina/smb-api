// Pure payroll math, kept free of Prisma so it can be unit-tested directly.
//
//   payout       = (daysWorked × dailyRate) + (otHours × otHourlyRate) − lessCa
//   otHourlyRate = (dailyRate ÷ hoursPerDay) × otMultiplier
//
// An otMultiplier of 1 gives a plain hourly OT rate with no premium, which is
// what the spreadsheet this replaces was doing. Raise it (e.g. 1.25) per member
// without touching this code.

export type RateInputs = {
    dailyRate: number;
    hoursPerDay: number;
    otMultiplier: number;
};

export const otHourlyRate = ({ dailyRate, hoursPerDay, otMultiplier }: RateInputs): number => {
    const hours = hoursPerDay || 8;
    return (dailyRate / hours) * otMultiplier;
};

// A day counts as worked when it is not a rest day and has a start time. Rest
// days ("RD") and unfilled cells both fall out.
export const countDaysWorked = (shifts: { isRestDay: boolean; startMinute: number | null; endMinute?: number | null }[]): number =>
    shifts.filter((s) => !s.isRestDay && s.startMinute !== null).length;

export const computePayout = (input: {
    daysWorked: number;
    dailyRate: number;
    otHours: number;
    otHourlyRate: number;
    lessCa: number;
}): number =>
    input.daysWorked * input.dailyRate +
    input.otHours * input.otHourlyRate -
    input.lessCa;

// Scheduled minutes across the week, used only to suggest an OT figure to the
// owner. OT is entered manually — identical shift patterns legitimately carry
// different OT — so this is a hint, never the stored value.
export const scheduledMinutes = (shifts: { isRestDay: boolean; startMinute: number | null; endMinute: number | null }[]): number =>
    shifts.reduce((total, shift) => {
        if (shift.isRestDay || shift.startMinute === null || shift.endMinute === null) return total;
        return total + (shift.endMinute - shift.startMinute);
    }, 0);

// OT derived from the roster:
//   (scheduled minutes − unpaid breaks) − (worked days × a regular day)
//
// The break matters: a 9AM-6PM shift is 9 scheduled hours, but with a 1-hour
// unpaid break it is exactly one 8-hour day and generates no OT. Without it
// every ordinary day would look like an hour of overtime.
export const computeOtHours = (
    shifts: { isRestDay: boolean; startMinute: number | null; endMinute: number | null }[],
    hoursPerDay: number,
    breakMinutes = 0
): number => {
    const worked = countDaysWorked(shifts);
    const paidMinutes = scheduledMinutes(shifts) - worked * Math.max(0, breakMinutes);
    const regularMinutes = worked * (hoursPerDay || 8) * 60;
    const overMinutes = paidMinutes - regularMinutes;
    return overMinutes > 0 ? Math.round((overMinutes / 60) * 100) / 100 : 0;
};

// Kept as the previous name for the "suggestion" reading; identical maths.
export const suggestedOtHours = computeOtHours;

// Effective-dated rate lookup. Generic over the row shape so it stays free of
// Prisma types: callers load the store's compensation rows once and resolve in
// memory, because a per-row query turns any multi-week view into an N+1.
export type EffectiveDated = {
    storeMemberId: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
};

export const compensationOn = <T extends EffectiveDated>(
    comps: T[],
    storeMemberId: string,
    onDate: Date
): T | null => {
    let best: T | null = null;
    for (const c of comps) {
        if (c.storeMemberId !== storeMemberId) continue;
        if (c.effectiveFrom > onDate) continue;
        if (c.effectiveTo !== null && c.effectiveTo < onDate) continue;
        if (!best || c.effectiveFrom > best.effectiveFrom) best = c;
    }
    return best;
};
