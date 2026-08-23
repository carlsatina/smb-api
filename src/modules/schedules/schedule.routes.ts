import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { requireStoreRole } from '../../middlewares/requireStoreRole';
import {
    clockIn,
    clockOut,
    copyWeek,
    createCashAdvance,
    createPreset,
    createTimeEntry,
    deleteCashAdvance,
    deletePreset,
    deleteTimeEntry,
    deleteWeek,
    getMemberMonth,
    getMonthSummary,
    getMyAttendance,
    getStackedMonth,
    getWeek,
    listAttendance,
    listCashAdvances,
    listCompensations,
    listMembers,
    listPresets,
    listWeeks,
    publishWeek,
    removeDeduction,
    setCompensation,
    setDeduction,
    updatePreset,
    updateTimeEntry,
    upsertWeek,
} from './schedule.controller';

export const scheduleRouter = Router({ mergeParams: true });

// Every store member can read the schedule — staff need to see each other's
// shifts to coordinate. The service masks the pay columns per row.
const anyMember = [
    authMiddleware,
    requireStoreRole([Role.OWNER, Role.ADMIN, Role.CASHIER, Role.INVENTORY_MANAGER, Role.VIEWER]),
];

// Writes are owner/admin only. This is the real read-only enforcement for
// staff; the frontend hiding controls is only UX.
const managers = [authMiddleware, requireStoreRole([Role.OWNER, Role.ADMIN])];

// Weeks
scheduleRouter.get('/weeks', ...anyMember, listWeeks);
scheduleRouter.get('/week', ...anyMember, getWeek);
scheduleRouter.put('/week', ...managers, upsertWeek);
scheduleRouter.post('/week/publish', ...managers, publishWeek);
scheduleRouter.post('/week/copy', ...managers, copyWeek);
scheduleRouter.delete('/week', ...managers, deleteWeek);

// Month views — both masked per viewer in the service (staff see only
// themselves), so they sit on the any-member guard.
scheduleRouter.get('/month-summary', ...anyMember, getMonthSummary);
scheduleRouter.get('/member-month', ...anyMember, getMemberMonth);
scheduleRouter.get('/stacked-month', ...anyMember, getStackedMonth);

// Staff list for the grid
scheduleRouter.get('/members', ...anyMember, listMembers);

// Shift presets
scheduleRouter.get('/presets', ...anyMember, listPresets);
scheduleRouter.post('/presets', ...managers, createPreset);
scheduleRouter.put('/presets/:presetId', ...managers, updatePreset);
scheduleRouter.delete('/presets/:presetId', ...managers, deletePreset);

// Pay rates — never exposed to staff, not even their own
scheduleRouter.get('/rates', ...managers, listCompensations);
scheduleRouter.put('/rates/:storeMemberId', ...managers, setCompensation);

// Cash advances — staff see only their own, managers see the store
scheduleRouter.get('/cash-advances', ...anyMember, listCashAdvances);
scheduleRouter.post('/cash-advances', ...managers, createCashAdvance);
scheduleRouter.delete('/cash-advances/:cashAdvanceId', ...managers, deleteCashAdvance);

// Per-week deductions against an advance
scheduleRouter.put('/rows/:rowId/deduction', ...managers, setDeduction);
scheduleRouter.delete('/rows/:rowId/deduction/:deductionId', ...managers, removeDeduction);

// ── Time clock ───────────────────────────────────────────────────────────────
// Punching is self-service: any member clocks themselves in and out, and the
// service resolves *which* member from the session — never from the body.
scheduleRouter.get('/attendance/me', ...anyMember, getMyAttendance);
scheduleRouter.post('/attendance/clock-in', ...anyMember, clockIn);
scheduleRouter.post('/attendance/clock-out', ...anyMember, clockOut);

// Attendance is pay-adjacent, so the service returns only the viewer's own rows
// to staff. Corrections are manager-only — otherwise the clock is decorative.
scheduleRouter.get('/attendance', ...anyMember, listAttendance);
scheduleRouter.post('/attendance', ...managers, createTimeEntry);
scheduleRouter.put('/attendance/:entryId', ...managers, updateTimeEntry);
scheduleRouter.delete('/attendance/:entryId', ...managers, deleteTimeEntry);
