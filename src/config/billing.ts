import { toZonedDateString, zonedStartOfDay } from '../shared/datetime';

// Per-store monthly pricing. Each owner's stores are ranked oldest first; the
// first store costs STORE_FEES[0], the second STORE_FEES[1], and every store
// after that costs ADDITIONAL_STORE_FEE. Warehouses count like any other store.
export const BILLING_CURRENCY = 'PHP';
export const STORE_FEES = [500, 400] as const;
export const ADDITIONAL_STORE_FEE = 300;

// Billing months follow Philippine time, matching the stores' default timezone.
export const BILLING_TIMEZONE = 'Asia/Manila';

export const storeFeeForPosition = (position: number): number =>
    STORE_FEES[position - 1] ?? ADDITIONAL_STORE_FEE;

export type BillableStore = {
    id: string;
    name: string;
    storeType: string;
    createdAt: Date;
};

export type BillingLine = {
    storeId: string;
    storeName: string;
    storeType: string;
    position: number;
    fee: number;
};

// Ranks stores by creation (id as a stable tiebreaker) and prices each one.
export const buildBillingLines = (stores: BillableStore[]): BillingLine[] =>
    [...stores]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .map((store, index) => ({
            storeId: store.id,
            storeName: store.name,
            storeType: store.storeType,
            position: index + 1,
            fee: storeFeeForPosition(index + 1),
        }));

export const sumBillingLines = (lines: BillingLine[]): number =>
    lines.reduce((total, line) => total + line.fee, 0);

const pad = (value: number) => String(value).padStart(2, '0');

// [start, end) of a billing month as UTC instants.
export const billingMonthRange = (year: number, month: number) => {
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    return {
        start: zonedStartOfDay(`${year}-${pad(month)}-01`, BILLING_TIMEZONE),
        end: zonedStartOfDay(`${nextYear}-${pad(nextMonth)}-01`, BILLING_TIMEZONE),
    };
};

export const currentBillingMonth = (now = new Date()) => {
    const [year, month] = toZonedDateString(now, BILLING_TIMEZONE).split('-').map(Number);
    return { year, month };
};

export const pricingSummary = () => ({
    currency: BILLING_CURRENCY,
    storeFees: [...STORE_FEES],
    additionalStoreFee: ADDITIONAL_STORE_FEE,
});
