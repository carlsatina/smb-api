import prisma from '../../lib/prisma';
import { currentBillingMonth } from '../config/billing';

export const BILLING_SUSPENDED_MESSAGE =
    'This store is read-only because the account has an unpaid bill. You can still view and export data. Contact support to restore full access.';

// HTTP methods a billing-suspended store still accepts: reading and exporting.
export const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const isMonthEnded = (year: number, month: number, now = new Date()) => {
    const current = currentBillingMonth(now);
    return year < current.year || (year === current.year && month < current.month);
};

export type OverdueMonth = { year: number; month: number; amount: number };

// Overdue = a bill was sent for a month that has ended and it is still unpaid.
// Months that were never billed don't count, so history before billing
// started (or a month an admin chose not to bill) never shows as overdue.
export const findOverdueByOwner = async (ownerIds: string[]) => {
    const result = new Map<string, OverdueMonth[]>();
    if (ownerIds.length === 0) return result;

    const statements = await prisma.billingStatement.findMany({
        where: { ownerId: { in: ownerIds }, sentAt: { not: null }, paidAt: null, amount: { gt: 0 } },
        select: { ownerId: true, year: true, month: true, amount: true },
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });

    for (const st of statements) {
        if (!isMonthEnded(st.year, st.month)) continue;
        const list = result.get(st.ownerId) ?? [];
        list.push({ year: st.year, month: st.month, amount: Number(st.amount) });
        result.set(st.ownerId, list);
    }
    return result;
};
