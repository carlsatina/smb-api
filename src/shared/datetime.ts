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

/**
 * The calendar date (YYYY-MM-DD) an instant falls on in `timeZone`. Used to
 * decide which work day a punch belongs to — the store's day, not UTC's.
 */
export const toZonedDateString = (instant: Date, timeZone: string): string => {
    const offset = getTimezoneOffsetMs(instant, timeZone);
    return new Date(instant.getTime() + offset).toISOString().slice(0, 10);
};

/**
 * The UTC instant of local midnight on `dateString` (YYYY-MM-DD) in `timeZone`.
 * Minutes measured from here can exceed 1440, which is exactly what an
 * overnight shift needs.
 */
export const zonedStartOfDay = (dateString: string, timeZone: string): Date => {
    const [year, month, day] = dateString.split('-').map(Number);
    return zonedWallTimeToUtc(year, month, day, 0, 0, 0, timeZone);
};

const fromComponents = (
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    timeZone: string
): Date | null => {
    const parsed = zonedWallTimeToUtc(year, month, day, hour, minute, second, timeZone);
    return isNaN(parsed.getTime()) ? null : parsed;
};

// Matches an explicit UTC/offset suffix: trailing "Z" or "+HH:MM" / "-HH:MM" / "+HHMM".
const HAS_EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

// Matches a naive ISO-like date or datetime with no zone information.
const NAIVE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

// Matches slash/dash/dot-separated spreadsheet/locale dates with an optional
// time and AM/PM — e.g. "7/31/2025, 8:36:55 PM", "31/7/2025 20:36", "7-31-2025".
// Excel/Sheets emit these after opening an exported CSV, and they carry no zone.
const SLASH_DATETIME =
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;

/**
 * Parses a date string for CSV import, interpreting timezone-less values as
 * wall-clock time in the given store `timeZone`.
 *
 * - Strings with an explicit offset/Z (e.g. our own exports) parse as-is.
 * - Naive ISO strings ("2025-07-31", "2025-07-31 20:36") and locale/spreadsheet
 *   strings ("7/31/2025, 8:36:55 PM") are interpreted in `timeZone`.
 * - Anything else falls back to the native Date parser.
 *
 * Returns null when the value cannot be parsed into a valid date.
 */
export const parseImportDate = (value: string, timeZone: string): Date | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Explicit timezone present (our ISO exports) — trust the native parser.
    if (HAS_EXPLICIT_OFFSET.test(trimmed)) {
        const explicit = new Date(trimmed);
        return isNaN(explicit.getTime()) ? null : explicit;
    }

    const iso = NAIVE_ISO.exec(trimmed);
    if (iso) {
        const [, y, mo, d, h, mi, s] = iso;
        return fromComponents(Number(y), Number(mo), Number(d), h ? Number(h) : 0, mi ? Number(mi) : 0, s ? Number(s) : 0, timeZone);
    }

    const slash = SLASH_DATETIME.exec(trimmed);
    if (slash) {
        let month = Number(slash[1]);
        let day = Number(slash[2]);
        // Disambiguate D/M vs M/D: a first field > 12 can only be the day.
        if (month > 12 && day <= 12) {
            [month, day] = [day, month];
        }
        const year = Number(slash[3]);
        let hour = slash[4] ? Number(slash[4]) : 0;
        const minute = slash[5] ? Number(slash[5]) : 0;
        const second = slash[6] ? Number(slash[6]) : 0;
        const meridiem = slash[7]?.toLowerCase();
        if (meridiem === 'pm' && hour < 12) hour += 12;
        if (meridiem === 'am' && hour === 12) hour = 0;
        return fromComponents(year, month, day, hour, minute, second, timeZone);
    }

    const fallback = new Date(trimmed);
    return isNaN(fallback.getTime()) ? null : fallback;
};
