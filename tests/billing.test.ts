import { describe, expect, it } from 'vitest';
import {
    billingMonthRange,
    buildBillingLines,
    computeDiscount,
    currentBillingMonth,
    isActiveForMonth,
    ownerDiscountForMonth,
    priceStatement,
    storeFeeForPosition,
    sumBillingLines,
} from '../src/config/billing';

const store = (id: string, createdAt: string, storeType = 'RETAIL', exempt = false) => ({
    id,
    name: `Store ${id}`,
    storeType,
    createdAt: new Date(createdAt),
    exempt,
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

    it('leaves free stores out of the ranking so the rest keep their slots', () => {
        const lines = buildBillingLines([
            store('a', '2026-01-01T00:00:00Z', 'RETAIL', true),
            store('b', '2026-02-01T00:00:00Z'),
            store('c', '2026-03-01T00:00:00Z'),
        ]);
        expect(lines.map((l) => [l.storeId, l.position, l.fee, Boolean(l.exempt)])).toEqual([
            ['b', 1, 500, false],
            ['c', 2, 400, false],
            ['a', null, 0, true],
        ]);
        expect(sumBillingLines(lines)).toBe(900);
    });

    it('applies percent and fixed discounts, capped at the subtotal', () => {
        expect(computeDiscount(1200, { type: 'PERCENT', value: 25, note: null })).toBe(300);
        expect(computeDiscount(1200, { type: 'PERCENT', value: 150, note: null })).toBe(1200);
        expect(computeDiscount(500, { type: 'FIXED', value: 200, note: null })).toBe(200);
        expect(computeDiscount(500, { type: 'FIXED', value: 900, note: null })).toBe(500);
        expect(computeDiscount(500, null)).toBe(0);
        expect(computeDiscount(1000, { type: 'PERCENT', value: 33.33, note: null })).toBe(333.3);
    });

    it('prices a statement with its discount', () => {
        const lines = buildBillingLines([store('a', '2026-01-01T00:00:00Z'), store('b', '2026-02-01T00:00:00Z')]);
        const priced = priceStatement(lines, { type: 'PERCENT', value: 10, note: 'Loyal customer' });
        expect(priced).toMatchObject({ subtotal: 900, discountAmount: 90, amount: 810 });
        expect(priced.discountNote).toBe('10% off (Loyal customer)');
        expect(priceStatement(lines, null)).toMatchObject({ subtotal: 900, discountAmount: 0, amount: 900, discountNote: null });
    });

    it('stops a discount after its through-month', () => {
        const nov = billingMonthRange(2026, 11);
        const dec = billingMonthRange(2026, 12);
        const endsAt = nov.end; // "through November 2026"
        expect(isActiveForMonth(endsAt, nov.start)).toBe(true);
        expect(isActiveForMonth(endsAt, dec.start)).toBe(false);
        expect(isActiveForMonth(null, dec.start)).toBe(true);

        const owner = { billingDiscountType: 'FIXED' as const, billingDiscountValue: 100, billingDiscountEndsAt: endsAt, billingDiscountNote: null };
        expect(ownerDiscountForMonth(owner, nov.start)).toEqual({ type: 'FIXED', value: 100, note: null });
        expect(ownerDiscountForMonth(owner, dec.start)).toBeNull();
    });
});
