import { Role } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { AuthRequest } from '../../middlewares/auth';
import { AppError } from '../../shared/errors';

/**
 * "Manage schedules & payroll" can be delegated to any role, so a holder could
 * otherwise raise their own pay. Only the owner may change payroll data
 * (pay rates, cash advances, deductions, time entries, manual OT) about
 * themselves.
 */
const OWN_PAYROLL_MESSAGE = "You can't change your own pay rate, cash advances, deductions, time entries or overtime.";

const isOwner = (req: AuthRequest) => req.storeRole === Role.OWNER;

export const assertNotOwnPayroll = async (req: AuthRequest, storeId: string, storeMemberId: string | null | undefined) => {
    if (isOwner(req) || !storeMemberId) return;
    const target = await prisma.storeMember.findFirst({
        where: { id: storeMemberId, storeId },
        select: { userId: true },
    });
    if (target && target.userId === req.user?.sub) {
        throw new AppError('FORBIDDEN', OWN_PAYROLL_MESSAGE, 403);
    }
};

export const memberIdForCashAdvance = async (storeId: string, cashAdvanceId: string) =>
    (
        await prisma.cashAdvance.findFirst({
            where: { id: cashAdvanceId, storeId },
            select: { storeMemberId: true },
        })
    )?.storeMemberId ?? null;

export const memberIdForWeekRow = async (storeId: string, rowId: string) =>
    (
        await prisma.scheduleWeekRow.findFirst({
            where: { id: rowId, scheduleWeek: { storeId } },
            select: { storeMemberId: true },
        })
    )?.storeMemberId ?? null;

export const memberIdForTimeEntry = async (storeId: string, entryId: string) =>
    (
        await prisma.timeEntry.findFirst({
            where: { id: entryId, storeId },
            select: { storeMemberId: true },
        })
    )?.storeMemberId ?? null;

/**
 * The weekly grid carries a manual OT override per row. A non-owner may save the
 * week with their own row, but not change its manual OT.
 */
export const assertOwnOvertimeUnchanged = async (
    req: AuthRequest,
    storeId: string,
    weekStart: string,
    rows: Array<{ storeMemberId: string; otHours: number; otAuto: boolean }>
) => {
    if (isOwner(req)) return;
    const self = await prisma.storeMember.findFirst({
        where: { storeId, userId: req.user?.sub, deletedAt: null },
        select: { id: true },
    });
    const ownRow = self ? rows.find((row) => row.storeMemberId === self.id) : undefined;
    if (!self || !ownRow || ownRow.otAuto) return;

    const existing = await prisma.scheduleWeekRow.findFirst({
        where: {
            storeMemberId: self.id,
            scheduleWeek: { storeId, weekStart: new Date(`${weekStart}T00:00:00.000Z`), deletedAt: null },
        },
        select: { otAuto: true, otHours: true },
    });
    const unchanged =
        existing && !existing.otAuto && Number(existing.otHours) === Number(ownRow.otHours);
    if (!unchanged) {
        throw new AppError('FORBIDDEN', OWN_PAYROLL_MESSAGE, 403);
    }
};
