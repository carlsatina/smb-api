import { z } from 'zod';
import { SHIFT_ICONS } from './schedule.icons';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

// Minutes from local midnight. Allows up to 48h so overnight shifts can be
// expressed as an endMinute past 1440 (e.g. 22:00 -> 06:00 next day = 1320/1800).
const minuteOfDay = z.number().int().min(0).max(2880);

export const monthQuerySchema = z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
});

export const memberMonthQuerySchema = monthQuerySchema.extend({
    storeMemberId: z.string().min(1),
});

export const getWeekQuerySchema = z.object({
    weekStart: dateString,
});

export const listWeeksQuerySchema = z.object({
    from: dateString.optional(),
    to: dateString.optional(),
    limit: z.coerce.number().int().min(1).max(52).default(12),
});

const shiftSchema = z
    .object({
        date: dateString,
        isRestDay: z.boolean().default(false),
        startMinute: minuteOfDay.nullable().optional(),
        endMinute: minuteOfDay.nullable().optional(),
        presetId: z.string().nullable().optional(),
    })
    .superRefine((val, ctx) => {
        if (val.isRestDay) return;
        if (val.startMinute == null || val.endMinute == null) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'A working day needs both a start and end time',
            });
            return;
        }
        if (val.endMinute <= val.startMinute) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'End time must be after start time (use minutes past 1440 for overnight shifts)',
            });
        }
    });

export const upsertWeekSchema = z.object({
    weekStart: dateString,
    rows: z
        .array(
            z.object({
                storeMemberId: z.string().min(1),
                otHours: z.number().min(0).max(200).default(0),
                // true = derive from the roster; false = otHours is an override.
                otAuto: z.boolean().default(true),
                remarks: z.string().max(500).nullable().optional(),
                sortOrder: z.number().int().min(0).default(0),
                shifts: z.array(shiftSchema).max(7),
            })
        )
        .max(100),
});

export const publishWeekSchema = z.object({
    // Publishing freezes rates + payout onto each row; unpublishing reopens it.
    publish: z.boolean().default(true),
});

export const copyWeekSchema = z.object({
    fromWeekStart: dateString,
    toWeekStart: dateString,
    // Shift patterns and rest days always carry over; OT/CA/remarks are
    // week-specific and are deliberately not copied.
    overwrite: z.boolean().default(false),
});

export const upsertPresetSchema = z.object({
    label: z.string().min(1).max(40),
    icon: z.enum(SHIFT_ICONS).default('none'),
    startMinute: minuteOfDay,
    endMinute: minuteOfDay,
    sortOrder: z.number().int().min(0).default(0),
});

export const upsertCompensationSchema = z.object({
    dailyRate: z.number().min(0),
    hoursPerDay: z.number().min(1).max(24).default(8),
    breakMinutes: z.number().int().min(0).max(480).default(0),
    otMultiplier: z.number().min(0).max(5).default(1),
    effectiveFrom: dateString,
});

export const createCashAdvanceSchema = z.object({
    storeMemberId: z.string().min(1),
    amount: z.number().positive(),
    takenOn: dateString,
    note: z.string().max(500).nullable().optional(),
});

export const setDeductionSchema = z.object({
    cashAdvanceId: z.string().min(1),
    amount: z.number().min(0),
    skipped: z.boolean().default(false),
    reason: z.string().max(500).nullable().optional(),
});

// ── Time clock ───────────────────────────────────────────────────────────────

export const attendanceRangeQuerySchema = z.object({
    from: dateString,
    to: dateString,
    storeMemberId: z.string().min(1).optional(),
});

export const punchSchema = z.object({
    note: z.string().max(500).nullable().optional(),
});

// Manager correction. Times are minutes from the work day's local midnight, the
// same axis the roster uses, so an overnight punch-out is a value past 1440.
export const upsertTimeEntrySchema = z.object({
    storeMemberId: z.string().min(1),
    workDate: dateString,
    clockInMinute: minuteOfDay,
    clockOutMinute: minuteOfDay.nullable().default(null),
    note: z.string().max(500).nullable().optional(),
});
