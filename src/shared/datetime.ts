/**
 * Returns the offset (in ms) of `timeZone` from UTC at the given instant.
 * Positive means the zone is ahead of UTC (e.g. Asia/Manila = +8h).
 */
const getTimezoneOffsetMs = (instant: Date, timeZone: string): number => {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

    const parts = dtf.formatToParts(instant);
    const map: Record<string, number> = {};
    for (const part of parts) {
        if (part.type !== 'literal') map[part.type] = Number(part.value);
    }

    // Intl can emit hour "24" for midnight in some locales/zones.
    const hour = map.hour === 24 ? 0 : map.hour;
    const asUTC = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
    // The formatter resolves only to whole seconds, so subtracting an instant
    // that carries milliseconds would skew the result. Zone offsets are always
    // whole minutes, so round to the nearest minute to stay exact.
    return Math.round((asUTC - instant.getTime()) / 60000) * 60000;
};

/**
 * Interprets naive wall-clock components as a time in `timeZone` and returns
 * the corresponding UTC Date. Uses a two-pass refinement so it stays correct
 * across DST boundaries (no-op for fixed-offset zones like Asia/Manila).
 */
const zonedWallTimeToUtc = (
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    timeZone: string
): Date => {
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
    const offset = getTimezoneOffsetMs(new Date(utcGuess), timeZone);
    const refined = getTimezoneOffsetMs(new Date(utcGuess - offset), timeZone);
    return new Date(utcGuess - refined);
};

// Matches an explicit UTC/offset suffix: trailing "Z" or "+HH:MM" / "-HH:MM" / "+HHMM".
const HAS_EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

// Matches a naive ISO-like date or datetime with no zone information.
const NAIVE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Parses a date string for CSV import, interpreting timezone-less values as
 * wall-clock time in the given store `timeZone`.
 *
 * - Strings with an explicit offset/Z (e.g. our own exports) parse as-is.
 * - Naive ISO-like strings ("2026-06-15", "2026-06-15 14:30") are interpreted
 *   in `timeZone`.
 * - Anything else falls back to the native Date parser.
 *
 * Returns null when the value cannot be parsed into a valid date.
 */
export const parseImportDate = (value: string, timeZone: string): Date | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (!HAS_EXPLICIT_OFFSET.test(trimmed)) {
        const match = NAIVE_ISO.exec(trimmed);
        if (match) {
            const [, y, mo, d, h, mi, s] = match;
            const parsed = zonedWallTimeToUtc(
                Number(y),
                Number(mo),
                Number(d),
                h ? Number(h) : 0,
                mi ? Number(mi) : 0,
                s ? Number(s) : 0,
                timeZone
            );
            return isNaN(parsed.getTime()) ? null : parsed;
        }
    }

    const fallback = new Date(trimmed);
    return isNaN(fallback.getTime()) ? null : fallback;
};
