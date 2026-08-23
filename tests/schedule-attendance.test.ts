import { describe, expect, it } from 'vitest';
import {
    otHoursFromActual,
    plannedMinutes,
    punchedMinutes,
    reconcileDay,
    sumWeek,
    toHours,
} from '../src/modules/schedules/schedule.attendance';

const at = (h: number, m = 0) => h * 60 + m;

// The store's real pattern: 9AM-6PM with a 1-hour unpaid break = one 8-hour day.
const NINE_TO_6 = { isRestDay: false, startMinute: at(9), endMinute: at(18) };
const RD = { isRestDay: true, startMinute: null, endMinute: null };
// 10PM-6AM, expressed as minutes past the shift's own local midnight.
const OVERNIGHT = { isRestDay: false, startMinute: at(22), endMinute: at(30) };

const BREAK = { breakMinutes: 60 };

describe('plannedMinutes', () => {
    it('deducts the unpaid break so a 9-6 shift is an 8-hour day', () => {
        expect(plannedMinutes(NINE_TO_6, 60)).toBe(480);
    });

    it('is zero for a rest day and for an unrostered day', () => {
        expect(plannedMinutes(RD, 60)).toBe(0);
        expect(plannedMinutes(null, 60)).toBe(0);
    });

    it('measures an overnight shift across midnight', () => {
        expect(plannedMinutes(OVERNIGHT, 0)).toBe(480);
    });
});

describe('punchedMinutes', () => {
    it('ignores an open punch — a shift in progress has no total yet', () => {
        expect(punchedMinutes([{ inMinute: at(9), outMinute: null }], 60)).toBe(0);
    });

    it('sums a split shift and deducts the break once for the day', () => {
        const split = [
            { inMinute: at(9), outMinute: at(12) },
            { inMinute: at(13), outMinute: at(18) },
        ];
        expect(punchedMinutes(split, 60)).toBe(420);
    });
});

describe('reconcileDay', () => {
    it('reports an exact match as on time with no variance', () => {
        const day = reconcileDay(NINE_TO_6, [{ inMinute: at(9), outMinute: at(18) }], BREAK);
        expect(day.status).toBe('ON_TIME');
        expect(day.scheduledMinutes).toBe(480);
        expect(day.actualMinutes).toBe(480);
        expect(day.varianceMinutes).toBe(0);
    });

    it('flags a late punch and reports the exact minutes', () => {
        const day = reconcileDay(NINE_TO_6, [{ inMinute: at(9, 18), outMinute: at(18) }], BREAK);
        expect(day.status).toBe('LATE');
        expect(day.lateMinutes).toBe(18);
        expect(day.varianceMinutes).toBe(-18);
    });

    it('flags leaving early as undertime', () => {
        const day = reconcileDay(NINE_TO_6, [{ inMinute: at(9), outMinute: at(17) }], BREAK);
        expect(day.status).toBe('UNDERTIME');
        expect(day.earlyOutMinutes).toBe(60);
    });

    it('flags staying past the roster as overtime', () => {
        const day = reconcileDay(NINE_TO_6, [{ inMinute: at(9), outMinute: at(20) }], BREAK);
        expect(day.status).toBe('OVERTIME');
        expect(day.overtimeMinutes).toBe(120);
        expect(day.varianceMinutes).toBe(120);
    });

    it('stays OPEN while the member is still clocked in', () => {
        const day = reconcileDay(NINE_TO_6, [{ inMinute: at(9), outMinute: null }], BREAK);
        expect(day.status).toBe('OPEN');
        expect(day.isOpen).toBe(true);
        expect(day.actualMinutes).toBe(0);
    });

    it('only calls a missed shift ABSENT once the day is over', () => {
        expect(reconcileDay(NINE_TO_6, [], { ...BREAK, dayIsOver: false }).status).toBe('SCHEDULED');
        expect(reconcileDay(NINE_TO_6, [], { ...BREAK, dayIsOver: true }).status).toBe('ABSENT');
    });

    it('reports a punch on a rest day rather than rejecting it', () => {
        const day = reconcileDay(RD, [{ inMinute: at(9), outMinute: at(13) }], BREAK);
        expect(day.status).toBe('UNSCHEDULED');
        expect(day.scheduledMinutes).toBe(0);
        expect(day.actualMinutes).toBe(180);
    });

    it('handles an overnight shift punched out after midnight', () => {
        // Clocked in 10PM, out 6AM = minute 1800 of the day the shift started.
        const day = reconcileDay(OVERNIGHT, [{ inMinute: at(22), outMinute: at(30) }], { breakMinutes: 0 });
        expect(day.status).toBe('ON_TIME');
        expect(day.actualMinutes).toBe(480);
        expect(day.varianceMinutes).toBe(0);
    });

    it('applies grace to the badge but never to the reported minutes', () => {
        const day = reconcileDay(NINE_TO_6, [{ inMinute: at(9, 3), outMinute: at(18, 3) }], {
            ...BREAK,
            graceMinutes: 5,
        });
        expect(day.status).toBe('ON_TIME');
        expect(day.lateMinutes).toBe(0);
    });
});

describe('sumWeek', () => {
    it('rolls a week up and counts only days with a completed punch', () => {
        const week = [
            reconcileDay(NINE_TO_6, [{ inMinute: at(9), outMinute: at(18) }], BREAK),
            reconcileDay(NINE_TO_6, [{ inMinute: at(9, 30), outMinute: at(18) }], BREAK),
            reconcileDay(NINE_TO_6, [], { ...BREAK, dayIsOver: true }),
            reconcileDay(RD, [], BREAK),
            reconcileDay(NINE_TO_6, [{ inMinute: at(9), outMinute: null }], BREAK),
        ];
        const totals = sumWeek(week);
        expect(totals.daysWorked).toBe(2);
        expect(totals.daysAbsent).toBe(1);
        expect(totals.openDays).toBe(1);
        expect(totals.lateMinutes).toBe(30);
        expect(totals.actualMinutes).toBe(930);
        // Four rostered working days (the open one included) against two worked.
        expect(totals.scheduledMinutes).toBe(1920);
        expect(totals.varianceMinutes).toBe(-990);
    });
});

describe('otHoursFromActual', () => {
    it('suggests OT from hours actually punched beyond a regular day', () => {
        // 5 days, 8h each + 8 hours extra across the week.
        expect(otHoursFromActual(5 * 480 + 480, 5, 8)).toBe(8);
    });

    it('never suggests negative OT for a short week', () => {
        expect(otHoursFromActual(5 * 400, 5, 8)).toBe(0);
    });
});

describe('toHours', () => {
    it('rounds to two decimals, the unit the payout screen speaks', () => {
        expect(toHours(455)).toBe(7.58);
    });
});
