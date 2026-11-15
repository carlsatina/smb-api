import { DiscountMethod, DiscountScope, FieldRequirement } from '@prisma/client';
import { AppError } from '../../shared/errors';

/**
 * Server-side discount math for a sale. Pure (no DB) so it can be unit tested.
 *
 * Prices are VAT-inclusive. For a VAT-removing discount (Senior/PWD) each line's
 * exempt portion has its VAT taken out first, then the rate applies to the
 * VAT-exclusive amount: 56 → 50 (VAT 6) → 20% = 10 → pays 40.
 *
 * Stored per line: `discount` = VAT removed + discount (the total reduction, so
 * subtotal − discount = total keeps holding for reports and Daily Sales), with
 * `vatRemoved` and `vatExemptSales` as the breakdown.
 */

export type DiscountTypeConfig = {
    id: string;
    code: string;
    name: string;
    statutory: boolean;
    method: DiscountMethod;
    value: number;
    removesVat: boolean;
    scope: DiscountScope;
    holderName: FieldRequirement;
    holderIdNumber: FieldRequirement;
    allowOnChannels: boolean;
    roundToWhole: boolean;
    isActive: boolean;
    archived: boolean;
    /** ID types to pick from (Senior/PWD); empty = the discount's own code. */
    holderTypes?: HolderType[];
};

export type HolderType = { code: string; name: string };

export type DiscountApplicationInput = {
    ref: string;
    discountTypeId: string;
    scope: 'LINE' | 'SALE';
    holderName?: string | null;
    holderIdNumber?: string | null;
    dinerCount?: number;
    holderCount?: number;
    /** Required when the type has holder types: which one (e.g. SC or PWD). */
    holderType?: string | null;
};

export type DiscountLineInput = {
    qty: number;
    unitPrice: number;
    discount?: number;
    tax?: number;
    discountRef?: string;
};

export type DiscountedLine = {
    /** Total reduction from the line subtotal (VAT removed + discount). */
    discount: number;
    tax: number;
    vatRemoved: number;
    vatExemptSales: number;
    /** Index into `applications`, or null when no discount touched the line. */
    applicationIndex: number | null;
};

export type ResolvedApplication = {
    ref: string;
    type: DiscountTypeConfig;
    /** What the sale records: the picked holder type, or the type's own code/name. */
    code: string;
    name: string;
    scope: 'LINE' | 'SALE';
    holderName: string | null;
    holderIdNumber: string | null;
    dinerCount: number | null;
    holderCount: number | null;
    /** Discount given, excluding VAT removed. */
    amount: number;
    vatRemoved: number;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const toCents = (value: number) => Math.round((value + Number.EPSILON) * 100);

const includedVat = (amount: number, vatRate: number) =>
    amount > 0 && vatRate > 0 ? roundMoney((amount * vatRate) / (100 + vatRate)) : 0;

const bad = (code: string, message: string, details?: unknown) => new AppError(code, message, 400, details);

const resolveHolderField = (
    requirement: FieldRequirement,
    value: string | null | undefined,
    label: string,
    type: DiscountTypeConfig
) => {
    const trimmed = value?.trim() || null;
    if (requirement === FieldRequirement.OFF) return null;
    if (requirement === FieldRequirement.REQUIRED && !trimmed) {
        throw bad('DISCOUNT_HOLDER_REQUIRED', `${type.name} requires the ${label}.`, { code: type.code });
    }
    return trimmed;
};

/** Splits `totalCents` across `weights` proportionally; leftover cents go to the largest weights. */
const allocateCents = (totalCents: number, weights: number[]) => {
    const weightSum = weights.reduce((sum, w) => sum + w, 0);
    if (weightSum <= 0 || totalCents <= 0) return weights.map(() => 0);
    const raw = weights.map((w) => (totalCents * w) / weightSum);
    const floors = raw.map(Math.floor);
    let leftover = totalCents - floors.reduce((sum, v) => sum + v, 0);
    const order = raw
        .map((value, index) => ({ index, remainder: value - floors[index], weight: weights[index] }))
        .sort((a, b) => b.remainder - a.remainder || b.weight - a.weight);
    for (const entry of order) {
        if (leftover <= 0) break;
        floors[entry.index] += 1;
        leftover -= 1;
    }
    return floors;
};

export const applySaleDiscounts = (input: {
    lines: DiscountLineInput[];
    applications: DiscountApplicationInput[];
    types: Map<string, DiscountTypeConfig>;
    /** Store VAT rate in percent; 0 = not VAT-registered, nothing to remove. */
    vatRate: number;
    isChannelSale: boolean;
    /** Applications already on the sale (by ref) may use archived/inactive types when editing. */
    existingRefs?: Set<string>;
}): { lines: DiscountedLine[]; applications: ResolvedApplication[] } => {
    const { lines, applications, types, vatRate, isChannelSale } = input;
    const existingRefs = input.existingRefs ?? new Set<string>();

    const refs = new Set<string>();
    let saleWide: number | null = null;
    const resolved: ResolvedApplication[] = applications.map((app, index) => {
        if (refs.has(app.ref)) {
            throw bad('DUPLICATE_DISCOUNT_REF', 'Each discount must have a unique ref.', { ref: app.ref });
        }
        refs.add(app.ref);

        const type = types.get(app.discountTypeId);
        if (!type) {
            throw bad('DISCOUNT_TYPE_NOT_FOUND', 'That discount is not available.', { discountTypeId: app.discountTypeId });
        }
        if ((!type.isActive || type.archived) && !existingRefs.has(app.ref)) {
            throw bad('DISCOUNT_TYPE_INACTIVE', `${type.name} is turned off for this store.`, { code: type.code });
        }
        if (type.scope !== DiscountScope.BOTH && type.scope !== app.scope) {
            throw bad(
                'DISCOUNT_SCOPE_NOT_ALLOWED',
                type.scope === DiscountScope.LINE
                    ? `${type.name} can only be applied to individual items.`
                    : `${type.name} can only be applied to the whole order.`,
                { code: type.code }
            );
        }
        if (isChannelSale && !type.allowOnChannels) {
            throw bad('DISCOUNT_NOT_ON_CHANNEL', `${type.name} can't be used on channel orders.`, { code: type.code });
        }

        const holderTypes = type.holderTypes ?? [];
        let recorded: HolderType = { code: type.code, name: type.name };
        if (holderTypes.length) {
            const picked = holderTypes.find((option) => option.code === app.holderType);
            if (!picked) {
                throw bad(
                    'HOLDER_TYPE_REQUIRED',
                    `Choose ${holderTypes.map((option) => option.name).join(' or ')} for ${type.name}.`,
                    { code: type.code }
                );
            }
            recorded = picked;
        }

        let dinerCount: number | null = null;
        let holderCount: number | null = null;
        if (app.scope === 'SALE') {
            if (saleWide !== null) {
                throw bad('MULTIPLE_SALE_DISCOUNTS', 'Only one discount can apply to the whole order.');
            }
            saleWide = index;
            // Statutory group meals: the discount covers the holders' share of the bill.
            if (type.statutory) {
                dinerCount = app.dinerCount ?? null;
                holderCount = app.holderCount ?? null;
                if (!dinerCount || !holderCount || holderCount < 1 || dinerCount < holderCount) {
                    throw bad(
                        'DINER_COUNT_REQUIRED',
                        `Enter how many diners there are and how many of them get the ${type.name} discount.`,
                        { code: type.code }
                    );
                }
            }
        }

        return {
            ref: app.ref,
            type,
            code: recorded.code,
            name: recorded.name,
            scope: app.scope,
            holderName: resolveHolderField(type.holderName, app.holderName, 'name', type),
            holderIdNumber: resolveHolderField(type.holderIdNumber, app.holderIdNumber, 'ID number', type),
            dinerCount,
            holderCount,
            amount: 0,
            vatRemoved: 0,
        };
    });

    const refIndex = new Map(resolved.map((app, index) => [app.ref, index]));
    const lineApp: Array<number | null> = lines.map((line) => {
        if (line.discountRef === undefined || line.discountRef === null) return saleWide;
        const index = refIndex.get(line.discountRef);
        if (index === undefined) {
            throw bad('DISCOUNT_REF_NOT_FOUND', 'An item refers to a discount that is not on the sale.', {
                discountRef: line.discountRef,
            });
        }
        if (resolved[index].scope !== 'LINE') {
            throw bad('DISCOUNT_SCOPE_MISMATCH', 'A whole-sale discount cannot be attached to a single item.', {
                discountRef: line.discountRef,
            });
        }
        return index;
    });

    resolved.forEach((app, index) => {
        if (!lineApp.includes(index)) {
            throw bad('DISCOUNT_UNUSED', `${app.type.name} is not applied to any item.`, { ref: app.ref });
        }
    });

    // Lines no discount touches keep the client's manual discount/tax, as before.
    const out: DiscountedLine[] = lines.map((line) => ({
        discount: line.discount ?? 0,
        tax: line.tax ?? 0,
        vatRemoved: 0,
        vatExemptSales: 0,
        applicationIndex: null,
    }));

    resolved.forEach((app, appIndex) => {
        const { type } = app;
        const removeVat = type.removesVat && vatRate > 0;
        const share = app.dinerCount && app.holderCount ? app.holderCount / app.dinerCount : 1;
        const lineIndexes = lineApp.map((value, i) => (value === appIndex ? i : -1)).filter((i) => i >= 0);

        const parts = lineIndexes.map((i) => {
            const gross = roundMoney(lines[i].qty * lines[i].unitPrice);
            const portion = roundMoney(gross * share);
            const base = removeVat ? roundMoney(portion / (1 + vatRate / 100)) : portion;
            return { i, gross, portion, base, vatRemoved: roundMoney(portion - base), discount: 0 };
        });

        if (type.method === DiscountMethod.PERCENT) {
            parts.forEach((part) => {
                part.discount = roundMoney((part.base * type.value) / 100);
            });
        } else {
            const baseCents = parts.reduce((sum, part) => sum + toCents(part.base), 0);
            const totalCents = Math.min(toCents(type.value), baseCents);
            const allocated = allocateCents(totalCents, parts.map((part) => toCents(part.base)));
            parts.forEach((part, k) => {
                part.discount = allocated[k] / 100;
            });
        }

        if (type.roundToWhole && parts.length) {
            const net = roundMoney(parts.reduce((sum, p) => sum + p.gross - p.vatRemoved - p.discount, 0));
            const adjustment = roundMoney(net - Math.round(net));
            if (adjustment !== 0) {
                const largest = parts.reduce((best, p) => (p.gross > best.gross ? p : best), parts[0]);
                largest.discount = roundMoney(Math.min(Math.max(largest.discount + adjustment, 0), largest.base));
            }
        }

        parts.forEach((part) => {
            const lineTotal = roundMoney(part.gross - part.vatRemoved - part.discount);
            // VAT stays only on what wasn't exempted; a plain discount keeps VAT on the discounted price.
            const tax = removeVat
                ? includedVat(roundMoney(part.gross - part.portion), vatRate)
                : includedVat(lineTotal, vatRate);
            out[part.i] = {
                discount: roundMoney(part.vatRemoved + part.discount),
                tax,
                vatRemoved: part.vatRemoved,
                vatExemptSales: removeVat ? part.base : 0,
                applicationIndex: appIndex,
            };
            app.amount = roundMoney(app.amount + part.discount);
            app.vatRemoved = roundMoney(app.vatRemoved + part.vatRemoved);
        });
    });

    return { lines: out, applications: resolved };
};
