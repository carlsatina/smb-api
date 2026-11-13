import { parseCSV } from '../../shared/csv';

export const EXPENSE_CSV_HEADERS = ['Date', 'Category', 'Amount', 'Note', 'Source', 'Added By'];

// Keeps a single import from running away; a year of daily entries fits easily.
export const MAX_EXPENSE_IMPORT_ROWS = 5000;

export type ParsedExpenseRow = {
    row: number;
    date: string;
    amount: number;
    category: string;
    note: string | null;
};

export type ExpenseCsvParseResult = {
    rows: ParsedExpenseRow[];
    errors: Array<{ row: number; message: string }>;
};

const pad = (n: number) => String(n).padStart(2, '0');

const isRealDate = (y: number, m: number, d: number) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

/**
 * Accepts YYYY-MM-DD (what export writes) and M/D/YYYY (what Excel turns it
 * into after opening and re-saving the file). Returns YYYY-MM-DD or null.
 */
export const parseExpenseDate = (value: string): string | null => {
    const text = value.trim();
    let y: number;
    let m: number;
    let d: number;
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
        [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    } else if ((match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
        [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    } else {
        return null;
    }
    return isRealDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** "₱1,200.50", "PHP 1200.5" and "1200.50" all read as 1200.5. */
export const parseExpenseAmount = (value: string): number | null => {
    const cleaned = value.trim().replace(/^[^\d.-]+/, '').replace(/,/g, '').trim();
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
    const amount = Number(cleaned);
    return amount > 0 ? Math.round(amount * 100) / 100 : null;
};

// Export prefixes risky text with an apostrophe (formula-injection guard);
// undo that so a round trip doesn't keep adding apostrophes.
const unguard = (value: string) => value.replace(/^'(?=[=+\-@\t\r])/, '');

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[\s_]+/g, '');

/**
 * Parses an expenses CSV. Category casing is normalized to the store's
 * configured option when one matches, so "rent" lands as "Rent".
 */
export const parseExpenseCsv = (text: string, categoryOptions: readonly string[] = []): ExpenseCsvParseResult => {
    const table = parseCSV(text.replace(/^﻿/, ''));
    if (table.length < 2) return { rows: [], errors: [{ row: 0, message: 'CSV file has no data rows' }] };

    const headers = table[0].map(normalizeHeader);
    const col = (...names: string[]) => names.map((n) => headers.indexOf(n)).find((i) => i !== -1) ?? -1;
    const dateCol = col('date');
    const categoryCol = col('category');
    const amountCol = col('amount');
    const noteCol = col('note', 'notes', 'description');
    if (dateCol === -1 || categoryCol === -1 || amountCol === -1) {
        return { rows: [], errors: [{ row: 1, message: 'CSV must include the columns Date, Category and Amount' }] };
    }
    if (table.length - 1 > MAX_EXPENSE_IMPORT_ROWS) {
        return {
            rows: [],
            errors: [{ row: 0, message: `Import at most ${MAX_EXPENSE_IMPORT_ROWS} expenses at a time; split the file.` }],
        };
    }

    const optionByLower = new Map(categoryOptions.map((c) => [c.trim().toLowerCase(), c]));
    const rows: ParsedExpenseRow[] = [];
    const errors: ExpenseCsvParseResult['errors'] = [];

    for (let i = 1; i < table.length; i++) {
        const r = table[i];
        const rowNum = i + 1;
        const date = parseExpenseDate(r[dateCol] ?? '');
        if (!date) {
            errors.push({ row: rowNum, message: 'Date must be YYYY-MM-DD or M/D/YYYY' });
            continue;
        }
        const amount = parseExpenseAmount(r[amountCol] ?? '');
        if (amount === null) {
            errors.push({ row: rowNum, message: 'Amount must be a number greater than 0' });
            continue;
        }
        const rawCategory = unguard((r[categoryCol] ?? '').trim());
        if (!rawCategory) {
            errors.push({ row: rowNum, message: 'Category is required' });
            continue;
        }
        if (rawCategory.length > 100) {
            errors.push({ row: rowNum, message: 'Category must be 100 characters or fewer' });
            continue;
        }
        const note = noteCol === -1 ? '' : unguard((r[noteCol] ?? '').trim());
        if (note.length > 500) {
            errors.push({ row: rowNum, message: 'Note must be 500 characters or fewer' });
            continue;
        }
        rows.push({
            row: rowNum,
            date,
            amount,
            category: optionByLower.get(rawCategory.toLowerCase()) ?? rawCategory,
            note: note || null,
        });
    }
    return { rows, errors };
};

/** Key used to recognise an expense that already exists (re-imported export). */
export const expenseDedupeKey = (e: { date: string; amount: number; category: string; note: string | null }) =>
    [e.date, e.amount.toFixed(2), e.category.trim().toLowerCase(), (e.note ?? '').trim().toLowerCase()].join('|');
