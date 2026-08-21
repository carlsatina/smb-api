import { describe, expect, it } from 'vitest';
import {
    computePayout,
    countDaysWorked,
    otHourlyRate,
    scheduledMinutes,
    suggestedOtHours,
} from '../src/modules/schedules/schedule.payroll';

const at = (h: number) => h * 60;

// Shift patterns from the payroll sheet this feature replaces.
const RD = { isRestDay: true, startMinute: null, endMinute: null };
const NOON_TO_9 = { isRestDay: false, startMinute: at(12), endMinute: at(21) };
const NINE_TO_6 = { isRestDay: false, startMinute: at(9), endMinute: at(18) };
const NINE_TO_9 = { isRestDay: false, startMinute: at(9), endMinute: at(21) };

// Rates implied by the sheet: ₱500/day over 8 hours, OT at a plain hourly rate
// (multiplier 1) = ₱62.50/hr.
const RATES = { dailyRate: 500, hoursPerDay: 8, otMultiplier: 1 };

describe('otHourlyRate', () => {
    it('derives 62.50/hr from a 500 daily rate over 8 hours', () => {
        expect(otHourlyRate(RATES)).toBe(62.5);
    });

    it('applies a premium multiplier when one is configured', () => {
        expect(otHourlyRate({ ...RATES, otMultiplier: 1.25 })).toBe(78.125);
    });

    it('falls back to an 8-hour day rather than dividing by zero', () => {
        expect(otHourlyRate({ ...RATES, hoursPerDay: 0 })).toBe(62.5);
    });
});

describe('countDaysWorked', () => {
    it('counts non-rest days only', () => {
        const week = [NOON_TO_9, RD, RD, NINE_TO_9, NINE_TO_9, NOON_TO_9, NOON_TO_9];
        expect(countDaysWorked(week)).toBe(5);
    });

    it('ignores unfilled cells', () => {
        expect(countDaysWorked([NINE_TO_6, { isRestDay: false, startMinute: null, endMinute: null }])).toBe(1);
    });
});

describe('computePayout — reproduces the source spreadsheet', () => {
    const rate = otHourlyRate(RATES);

    // Week of 5/31: both staff worked 5 days with 8 hours OT.
    it('Mary, week 1: 5 days + 8 OT less 375 CA = 2625', () => {
        expect(
            computePayout({ daysWorked: 5, dailyRate: 500, otHours: 8, otHourlyRate: rate, lessCa: 375 })
        ).toBe(2625);
    });

    it('Fe, week 1: 5 days + 8 OT less 875 CA = 2125', () => {
        expect(
            computePayout({ daysWorked: 5, dailyRate: 500, otHours: 8, otHourlyRate: rate, lessCa: 875 })
        ).toBe(2125);
    });

    // Week of 6/7: same 5 days, OT drops to 6.
    it('week 2: 5 days + 6 OT less 875 CA = 2000 for both staff', () => {
        expect(
            computePayout({ daysWorked: 5, dailyRate: 500, otHours: 6, otHourlyRate: rate, lessCa: 875 })
        ).toBe(2000);
    });

    it('gross before CA is identical for staff on the same shifts', () => {
        const gross = (lessCa: number) =>
            computePayout({ daysWorked: 5, dailyRate: 500, otHours: 8, otHourlyRate: rate, lessCa }) + lessCa;
        expect(gross(375)).toBe(3000);
        expect(gross(875)).toBe(3000);
    });
});

describe('scheduledMinutes / suggestedOtHours', () => {
    const maryWeek1 = [NOON_TO_9, RD, RD, NINE_TO_9, NINE_TO_9, NOON_TO_9, NOON_TO_9];

    it('totals only the worked days', () => {
        // 9h + 12h + 12h + 9h + 9h = 51h
        expect(scheduledMinutes(maryWeek1)).toBe(51 * 60);
    });

    it('suggests hours beyond a standard day', () => {
        // 51h scheduled against 5 × 8h regular = 11h over
        expect(suggestedOtHours(maryWeek1, 8)).toBe(11);
    });

    it('is a hint only — the sheet records 8 and 6 OT for identical patterns', () => {
        const week2 = [NINE_TO_6, RD, RD, NINE_TO_9, NINE_TO_9, NINE_TO_6, NINE_TO_6];
        // Same shape as week 1, so the same suggestion — yet the owner entered
        // 8 one week and 6 the next. OT stays a manual field.
        expect(suggestedOtHours(week2, 8)).toBe(suggestedOtHours(maryWeek1, 8));
    });

    it('never suggests negative OT', () => {
        expect(suggestedOtHours([NINE_TO_6, RD], 9)).toBe(0);
    });
});
