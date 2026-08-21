// Icon vocabulary for shift presets.
//
// Stored as a token rather than a raw icon name so the database stays
// independent of the frontend icon library, and so new glyphs can be added
// without a migration. The frontend maps these to mdi glyphs.
//
// Semantics are assigned per preset by the owner, not derived from the times:
// a 9AM-9PM shift both opens and closes, which no automatic open/close rule
// could express.
export const SHIFT_ICONS = [
    'none',
    'opening', // sun — first shift of the day
    'closing', // moon — last shift of the day
    'full-day', // sun + moon — opens and closes
    'sunrise',
    'sunset',
    'clock',
    'door-open',
    'door-closed',
] as const;

export type ShiftIcon = (typeof SHIFT_ICONS)[number];

export const isShiftIcon = (value: string): value is ShiftIcon =>
    (SHIFT_ICONS as readonly string[]).includes(value);
