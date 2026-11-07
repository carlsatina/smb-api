import { describe, expect, it } from 'vitest';
import {
    billingMonthRange,
    buildBillingLines,
    currentBillingMonth,
    storeFeeForPosition,
    sumBillingLines,
} from '../src/config/billing';

const store = (id: string, createdAt: string, storeType = 'RETAIL') => ({
    id,
    name: `Store ${id}`,
    storeType,
    createdAt: new Date(createdAt),
});

describe('per-store billing', () => {
    it('prices stores 500 / 400 / 300 and 300 thereafter', () => {
        expect([1, 2, 3, 4, 10].map(storeFeeForPosition)).toEqual([500, 400, 300, 300, 300]);
    });

    it('ranks stores oldest first regardless of input order', () => {
        const lines = buildBillingLines([
            store('c', '2026-03-01T00:00:00Z'),
            store('a', '2026-01-01T00:00:00Z'),
            store('d', '2026-04-01T00:00:00Z', 'WAREHOUSE'),
            store('b', '2026-02-01T00:00:00Z'),
        ]);
        expect(lines.map((l) => [l.storeId, l.position, l.fee])).toEqual([
            ['a', 1, 500],
            ['b', 2, 400],
            ['c', 3, 300],
            ['d', 4, 300],
        ]);
        expect(sumBillingLines(lines)).toBe(1500);
    });

    it('bills nothing for an owner with no stores', () => {
        expect(sumBillingLines(buildBillingLines([]))).toBe(0);
    });

    it('uses Manila month boundaries', () => {
        const { start, end } = billingMonthRange(2026, 12);
        expect(start.toISOString()).toBe('2026-11-30T16:00:00.000Z');
        expect(end.toISOString()).toBe('2026-12-31T16:00:00.000Z');
        // 2026-10-31 20:00 UTC is already November 1 in Manila.
        expect(currentBillingMonth(new Date('2026-10-31T20:00:00Z'))).toEqual({ year: 2026, month: 11 });
    });
});
