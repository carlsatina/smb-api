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
    // Complimentary for this billing month: billed at 0, not ranked.
    exempt?: boolean;
};

export type BillingLine = {
    storeId: string;
    storeName: string;
    storeType: string;
    // Price slot among the owner's paid stores; null for a free store.
    position: number | null;
    fee: number;
    exempt?: boolean;
};

export type BillingDiscountType = 'PERCENT' | 'FIXED';

export type BillingDiscount = {
    type: BillingDiscountType;
    value: number;
    note: string | null;
};

export type PricedStatement = {
    lines: BillingLine[];
    subtotal: number;
    discountAmount: number;
    discountNote: string | null;
    amount: number;
};

const byAge = (a: BillableStore, b: BillableStore) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

// Ranks paid stores by creation (id as a stable tiebreaker) and prices each
// one; free stores follow at 0 and don't take a price slot.
export const buildBillingLines = (stores: BillableStore[]): BillingLine[] => {
    const paid = stores.filter((s) => !s.exempt).sort(byAge);
    const free = stores.filter((s) => s.exempt).sort(byAge);
    return [
        ...paid.map((store, index) => ({
            storeId: store.id,
            storeName: store.name,
            storeType: store.storeType,
            position: index + 1,
            fee: storeFeeForPosition(index + 1),
        })),
        ...free.map((store) => ({
            storeId: store.id,
            storeName: store.name,
            storeType: store.storeType,
            position: null,
            fee: 0,
            exempt: true,
        })),
    ];
};

export const sumBillingLines = (lines: BillingLine[]): number =>
    lines.reduce((total, line) => total + line.fee, 0);

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export const computeDiscount = (subtotal: number, discount: BillingDiscount | null): number => {
    if (!discount || subtotal <= 0 || discount.value <= 0) return 0;
    const raw = discount.type === 'PERCENT' ? (subtotal * Math.min(discount.value, 100)) / 100 : discount.value;
    return roundMoney(Math.min(raw, subtotal));
};

export const describeDiscount = (discount: BillingDiscount) => {
    const base = discount.type === 'PERCENT' ? `${discount.value}% off` : `PHP ${discount.value.toFixed(2)} off`;
    return discount.note ? `${base} (${discount.note})` : base;
};

export const priceStatement = (lines: BillingLine[], discount: BillingDiscount | null): PricedStatement => {
    const subtotal = sumBillingLines(lines);
    const discountAmount = computeDiscount(subtotal, discount);
    return {
        lines,
        subtotal,
        discountAmount,
        discountNote: discountAmount > 0 && discount ? describeDiscount(discount) : null,
        amount: roundMoney(subtotal - discountAmount),
    };
};

// A discount or free-store setting with an end applies to billing months that
// start before it; no end means it applies indefinitely.
export const isActiveForMonth = (endsAt: Date | null, monthStart: Date) => !endsAt || monthStart < endsAt;

export const ownerDiscountForMonth = (
    owner: {
        billingDiscountType: BillingDiscountType | null;
        billingDiscountValue: { toString(): string } | number | null;
        billingDiscountEndsAt: Date | null;
        billingDiscountNote: string | null;
    },
    monthStart: Date
): BillingDiscount | null => {
    if (!owner.billingDiscountType || owner.billingDiscountValue === null) return null;
    if (!isActiveForMonth(owner.billingDiscountEndsAt, monthStart)) return null;
    return {
        type: owner.billingDiscountType,
        value: Number(owner.billingDiscountValue),
        note: owner.billingDiscountNote,
    };
};

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
