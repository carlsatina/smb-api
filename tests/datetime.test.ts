import { describe, expect, it } from 'vitest';
import { parseImportDate } from '../src/shared/datetime';

const MANILA = 'Asia/Manila'; // fixed +08:00, no DST

describe('parseImportDate', () => {
    it('interprets a naive datetime as wall-clock time in the store timezone', () => {
        // 8 PM in Manila on Jun 15 is 12:00 UTC, NOT 8 PM UTC.
        expect(parseImportDate('2026-06-15 20:00', MANILA)?.toISOString()).toBe('2026-06-15T12:00:00.000Z');
        expect(parseImportDate('2026-06-15T20:00:00', MANILA)?.toISOString()).toBe('2026-06-15T12:00:00.000Z');
    });

    it('treats a date-only value as local midnight in the store timezone', () => {
        // Midnight Jun 15 Manila = 16:00 UTC on Jun 14.
        expect(parseImportDate('2026-06-15', MANILA)?.toISOString()).toBe('2026-06-14T16:00:00.000Z');
    });

    it('respects an explicit UTC (Z) offset', () => {
        expect(parseImportDate('2026-06-15T20:00:00.000Z', MANILA)?.toISOString()).toBe('2026-06-15T20:00:00.000Z');
    });

    it('respects an explicit numeric offset', () => {
        expect(parseImportDate('2026-06-15T20:00:00+08:00', MANILA)?.toISOString()).toBe('2026-06-15T12:00:00.000Z');
    });

    it('honors the configured timezone, not the server timezone', () => {
        // Same naive value resolves differently per zone.
        const manila = parseImportDate('2026-06-15 20:00', MANILA)?.toISOString();
        const utc = parseImportDate('2026-06-15 20:00', 'UTC')?.toISOString();
        expect(manila).toBe('2026-06-15T12:00:00.000Z');
        expect(utc).toBe('2026-06-15T20:00:00.000Z');
    });

    it('interprets en-US spreadsheet datetimes (M/D/YYYY, h:mm:ss AM/PM) in the store timezone', () => {
        // 8:36:55 PM Manila on Jul 31 = 12:36:55 UTC — must NOT be read as UTC (+8h bug).
        expect(parseImportDate('7/31/2025, 8:36:55 PM', MANILA)?.toISOString()).toBe('2025-07-31T12:36:55.000Z');
        // 3:09 PM Manila → 07:09 UTC (regression: previously showed as 11:09 PM).
        expect(parseImportDate('7/24/2025, 3:09:54 PM', MANILA)?.toISOString()).toBe('2025-07-24T07:09:54.000Z');
    });

    it('handles 24-hour and day-first slash dates', () => {
        expect(parseImportDate('31/7/2025 20:36', MANILA)?.toISOString()).toBe('2025-07-31T12:36:00.000Z');
        expect(parseImportDate('7/31/2025 20:36:00', MANILA)?.toISOString()).toBe('2025-07-31T12:36:00.000Z');
    });

    it('returns null for unparseable or empty input', () => {
        expect(parseImportDate('garbage', MANILA)).toBeNull();
        expect(parseImportDate('', MANILA)).toBeNull();
    });
});
