import { describe, expect, it } from 'vitest';
import {
    expenseDedupeKey,
    parseExpenseAmount,
    parseExpenseCsv,
    parseExpenseDate,
} from '../src/modules/expenses/expense.csv';

describe('expense CSV parsing', () => {
    it('reads ISO and Excel-style dates and rejects impossible ones', () => {
        expect(parseExpenseDate('2026-11-03')).toBe('2026-11-03');
        expect(parseExpenseDate('11/3/2026')).toBe('2026-11-03');
        expect(parseExpenseDate('2026-02-30')).toBeNull();
        expect(parseExpenseDate('Nov 3')).toBeNull();
    });

    it('strips currency symbols and thousands separators from amounts', () => {
        expect(parseExpenseAmount('₱1,200.50')).toBe(1200.5);
        expect(parseExpenseAmount('PHP 300')).toBe(300);
        expect(parseExpenseAmount('0')).toBeNull();
        expect(parseExpenseAmount('-5')).toBeNull();
        expect(parseExpenseAmount('abc')).toBeNull();
    });

    it('parses rows, normalizes category casing and reports row errors', () => {
        const csv = [
            '﻿Date,Category,Amount,Note,Source,Added By',
            '2026-11-01,rent,"15,000.00",November rent,MANUAL,Owner',
            "2026-11-02,Supplies,120,'=ice,MANUAL,Cashier",
            '2026-11-02,Supplies,abc,,,',
            ',Supplies,50,,,',
        ].join('\n');
        const { rows, errors } = parseExpenseCsv(csv, ['Rent', 'Supplies']);
        expect(rows).toEqual([
            { row: 2, date: '2026-11-01', amount: 15000, category: 'Rent', note: 'November rent' },
            { row: 3, date: '2026-11-02', amount: 120, category: 'Supplies', note: '=ice' },
        ]);
        expect(errors.map((e) => e.row)).toEqual([4, 5]);
    });

    it('requires the Date, Category and Amount columns', () => {
        const { rows, errors } = parseExpenseCsv('Date,Amount\n2026-11-01,5', []);
        expect(rows).toHaveLength(0);
        expect(errors[0].message).toContain('Date, Category and Amount');
    });

    it('builds the same dedupe key regardless of case and note spacing', () => {
        expect(expenseDedupeKey({ date: '2026-11-01', amount: 5, category: 'Ice', note: ' bag ' })).toBe(
            expenseDedupeKey({ date: '2026-11-01', amount: 5.0, category: 'ice', note: 'Bag' })
        );
    });
});
