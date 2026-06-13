/**
 * Shared CSV helpers used by the export/import endpoints.
 */

const FORMULA_INJECTION_PREFIX = /^[=+\-@\t\r]/;

/**
 * Serialize a single cell value for CSV output.
 *
 * - Quotes values containing commas, quotes, or newlines (RFC 4180).
 * - Neutralizes CSV/formula injection by prefixing string values that begin
 *   with a risky character (= + - @ tab CR) with an apostrophe, so spreadsheet
 *   software does not evaluate them as formulas. Numeric/boolean values are
 *   left untouched so legitimate negative numbers are not corrupted.
 */
export const escapeCsvValue = (value: string | number | boolean | null | undefined): string => {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (typeof value === 'string' && FORMULA_INJECTION_PREFIX.test(text)) {
        text = `'${text}`;
    }
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
};

/**
 * Parse CSV text into rows of string fields. Handles quoted fields, escaped
 * quotes (""), and CRLF/LF line endings. Blank rows are skipped.
 */
export const parseCSV = (text: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];
        if (inQuotes) {
            if (char === '"' && next === '"') { field += '"'; i++; }
            else if (char === '"') { inQuotes = false; }
            else { field += char; }
        } else {
            if (char === '"') { inQuotes = true; }
            else if (char === ',') { row.push(field); field = ''; }
            else if (char === '\n') {
                row.push(field);
                if (row.some((f) => f.trim() !== '')) rows.push(row);
                row = []; field = '';
            } else if (char === '\r') {
                // skip \r
            } else { field += char; }
        }
    }
    if (field || row.length > 0) {
        row.push(field);
        if (row.some((f) => f.trim() !== '')) rows.push(row);
    }
    return rows;
};
