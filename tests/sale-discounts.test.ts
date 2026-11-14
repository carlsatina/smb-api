import { DiscountMethod, DiscountScope, FieldRequirement } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { applySaleDiscounts, type DiscountTypeConfig } from '../src/modules/sales/saleDiscounts';

const senior = (overrides: Partial<DiscountTypeConfig> = {}): DiscountTypeConfig => ({
    id: 'sc',
    code: 'SC',
    name: 'Senior Citizen',
    statutory: true,
    method: DiscountMethod.PERCENT,
    value: 20,
    removesVat: true,
    scope: DiscountScope.BOTH,
    holderName: FieldRequirement.REQUIRED,
    holderIdNumber: FieldRequirement.REQUIRED,
    allowOnChannels: false,
    roundToWhole: false,
    isActive: true,
    archived: false,
    ...overrides,
});

const employee = (overrides: Partial<DiscountTypeConfig> = {}): DiscountTypeConfig => ({
    ...senior(),
    id: 'emp',
    code: 'EMP',
    name: 'Employee',
    statutory: false,
    removesVat: false,
    value: 10,
    holderName: FieldRequirement.OFF,
    holderIdNumber: FieldRequirement.OFF,
    ...overrides,
});

const typesOf = (...types: DiscountTypeConfig[]) => new Map(types.map((t) => [t.id, t]));
const holder = { holderName: 'Juan Dela Cruz', holderIdNumber: 'OSCA-12345' };

describe('applySaleDiscounts', () => {
    it('removes VAT then takes 20% off only the senior line', () => {
        const result = applySaleDiscounts({
            lines: [
                { qty: 1, unitPrice: 112, tax: 12 },
                { qty: 1, unitPrice: 56, discountRef: 'a' },
                { qty: 1, unitPrice: 224, tax: 24 },
            ],
            applications: [{ ref: 'a', discountTypeId: 'sc', scope: 'LINE', ...holder }],
            types: typesOf(senior()),
            vatRate: 12,
            isChannelSale: false,
        });

        // 56 → 50 without VAT (6 removed) → 20% = 10 → pays 40.
        expect(result.lines[1]).toEqual({
            discount: 16,
            tax: 0,
            vatRemoved: 6,
            vatExemptSales: 50,
            applicationIndex: 0,
        });
        // Untouched lines keep what the client sent.
        expect(result.lines[0]).toMatchObject({ discount: 0, tax: 12, applicationIndex: null });
        expect(result.lines[2]).toMatchObject({ discount: 0, tax: 24, applicationIndex: null });
        expect(result.applications[0]).toMatchObject({
            amount: 10,
            vatRemoved: 6,
            holderName: 'Juan Dela Cruz',
            holderIdNumber: 'OSCA-12345',
        });
    });

    it('applies the rate to the full price when the store is not VAT-registered', () => {
        const result = applySaleDiscounts({
            lines: [{ qty: 1, unitPrice: 56, discountRef: 'a' }],
            applications: [{ ref: 'a', discountTypeId: 'sc', scope: 'LINE', ...holder }],
            types: typesOf(senior()),
            vatRate: 0,
            isChannelSale: false,
        });
        expect(result.lines[0]).toEqual({
            discount: 11.2,
            tax: 0,
            vatRemoved: 0,
            vatExemptSales: 0,
            applicationIndex: 0,
        });
    });

    it('rounds the discounted amount to a whole peso when the type asks for it', () => {
        // 90 / 1.12 = 80.36, less 20% (16.07) = 64.29 → 64.
        const result = applySaleDiscounts({
            lines: [{ qty: 1, unitPrice: 90, discountRef: 'a' }],
            applications: [{ ref: 'a', discountTypeId: 'sc', scope: 'LINE', ...holder }],
            types: typesOf(senior({ roundToWhole: true })),
            vatRate: 12,
            isChannelSale: false,
        });
        expect(result.lines[0].vatRemoved).toBe(9.64);
        expect(result.lines[0].discount).toBe(26);
        expect(result.applications[0].amount).toBe(16.36);
    });

    it('gives a group meal the seniors’ share of every line', () => {
        // 4 diners, 1 senior: a quarter of each line is VAT-exempt and discounted.
        const result = applySaleDiscounts({
            lines: [
                { qty: 1, unitPrice: 400 },
                { qty: 2, unitPrice: 100 },
            ],
            applications: [
                { ref: 'g', discountTypeId: 'sc', scope: 'SALE', dinerCount: 4, holderCount: 1, ...holder },
            ],
            types: typesOf(senior()),
            vatRate: 12,
            isChannelSale: false,
        });

        // Line 1: share 100 → 89.29 (10.71 VAT) → 17.86 off; VAT stays on the other 300.
        expect(result.lines[0]).toEqual({
            discount: 28.57,
            tax: 32.14,
            vatRemoved: 10.71,
            vatExemptSales: 89.29,
            applicationIndex: 0,
        });
        // Line 2: share 50 → 44.64 (5.36 VAT) → 8.93 off; VAT on the other 150.
        expect(result.lines[1]).toEqual({
            discount: 14.29,
            tax: 16.07,
            vatRemoved: 5.36,
            vatExemptSales: 44.64,
            applicationIndex: 0,
        });
        expect(result.applications[0]).toMatchObject({ dinerCount: 4, holderCount: 1, amount: 26.79, vatRemoved: 16.07 });
    });

    it('needs the diner count for a sale-wide statutory discount', () => {
        expect(() =>
            applySaleDiscounts({
                lines: [{ qty: 1, unitPrice: 100 }],
                applications: [{ ref: 'g', discountTypeId: 'sc', scope: 'SALE', ...holder }],
                types: typesOf(senior()),
                vatRate: 12,
                isChannelSale: false,
            })
        ).toThrow(expect.objectContaining({ code: 'DINER_COUNT_REQUIRED' }));
    });

    it('spreads a fixed sale-wide discount across lines and keeps VAT on the discounted price', () => {
        const result = applySaleDiscounts({
            lines: [
                { qty: 1, unitPrice: 100 },
                { qty: 1, unitPrice: 50, discountRef: 's' },
            ],
            applications: [
                { ref: 's', discountTypeId: 'sc', scope: 'LINE', ...holder },
                { ref: 'e', discountTypeId: 'emp', scope: 'SALE' },
            ],
            types: typesOf(senior(), employee({ method: DiscountMethod.FIXED, value: 30 })),
            vatRate: 12,
            isChannelSale: false,
        });

        // The senior line keeps its own discount; the ₱30 lands on the other line only.
        expect(result.lines[1].applicationIndex).toBe(0);
        expect(result.lines[0]).toEqual({
            discount: 30,
            tax: 7.5, // VAT inside the 70 actually charged
            vatRemoved: 0,
            vatExemptSales: 0,
            applicationIndex: 1,
        });
        expect(result.applications[1]).toMatchObject({ amount: 30, holderName: null, holderIdNumber: null });
    });

    it('splits a fixed discount proportionally with exact cents', () => {
        const result = applySaleDiscounts({
            lines: [
                { qty: 1, unitPrice: 100 },
                { qty: 1, unitPrice: 50 },
            ],
            applications: [{ ref: 'e', discountTypeId: 'emp', scope: 'SALE' }],
            types: typesOf(employee({ method: DiscountMethod.FIXED, value: 50 })),
            vatRate: 0,
            isChannelSale: false,
        });
        expect(result.lines.map((line) => line.discount)).toEqual([33.33, 16.67]);
        expect(result.applications[0].amount).toBe(50);
    });

    it('never discounts more than the lines are worth', () => {
        const result = applySaleDiscounts({
            lines: [{ qty: 1, unitPrice: 20 }],
            applications: [{ ref: 'e', discountTypeId: 'emp', scope: 'SALE' }],
            types: typesOf(employee({ method: DiscountMethod.FIXED, value: 500 })),
            vatRate: 0,
            isChannelSale: false,
        });
        expect(result.lines[0].discount).toBe(20);
    });

    it('enforces holder fields and drops them when the type has them off', () => {
        const run = (type: DiscountTypeConfig, extra: object) =>
            applySaleDiscounts({
                lines: [{ qty: 1, unitPrice: 50, discountRef: 'a' }],
                applications: [{ ref: 'a', discountTypeId: type.id, scope: 'LINE', ...extra }],
                types: typesOf(type),
                vatRate: 12,
                isChannelSale: false,
            });

        expect(() => run(senior(), { holderName: 'Juan', holderIdNumber: '  ' })).toThrow(
            expect.objectContaining({ code: 'DISCOUNT_HOLDER_REQUIRED' })
        );
        expect(run(senior({ holderIdNumber: FieldRequirement.OPTIONAL }), { holderName: 'Juan' }).applications[0])
            .toMatchObject({ holderName: 'Juan', holderIdNumber: null });
        expect(run(employee(), holder).applications[0]).toMatchObject({ holderName: null, holderIdNumber: null });
    });

    it('records the ID type the cashier picked for a Senior/PWD discount', () => {
        const merged = senior({
            id: 'scpwd',
            code: 'SCPWD',
            name: 'Senior Citizen / PWD',
            holderTypes: [
                { code: 'SC', name: 'Senior Citizen' },
                { code: 'PWD', name: 'Person with Disability' },
            ],
        });
        const run = (holderType?: string) =>
            applySaleDiscounts({
                lines: [{ qty: 1, unitPrice: 56, discountRef: 'a' }],
                applications: [{ ref: 'a', discountTypeId: 'scpwd', scope: 'LINE', holderType, ...holder }],
                types: typesOf(merged),
                vatRate: 12,
                isChannelSale: false,
            });

        expect(run('PWD').applications[0]).toMatchObject({ code: 'PWD', name: 'Person with Disability', amount: 10 });
        expect(() => run()).toThrow(expect.objectContaining({ code: 'HOLDER_TYPE_REQUIRED' }));
        expect(() => run('VIP')).toThrow(expect.objectContaining({ code: 'HOLDER_TYPE_REQUIRED' }));
        // Without holder types the discount records its own code.
        expect(applySaleDiscounts({
            lines: [{ qty: 1, unitPrice: 56, discountRef: 'a' }],
            applications: [{ ref: 'a', discountTypeId: 'sc', scope: 'LINE', ...holder }],
            types: typesOf(senior()),
            vatRate: 12,
            isChannelSale: false,
        }).applications[0]).toMatchObject({ code: 'SC', name: 'Senior Citizen' });
    });

    it('rejects misuse', () => {
        const base = {
            lines: [{ qty: 1, unitPrice: 50, discountRef: 'a' }],
            applications: [{ ref: 'a', discountTypeId: 'sc', scope: 'LINE' as const, ...holder }],
            vatRate: 12,
            isChannelSale: false,
        };
        const codeOf = (fn: () => unknown) => {
            try {
                fn();
            } catch (error) {
                return (error as { code: string }).code;
            }
            return null;
        };

        expect(codeOf(() => applySaleDiscounts({ ...base, types: new Map() }))).toBe('DISCOUNT_TYPE_NOT_FOUND');
        expect(codeOf(() => applySaleDiscounts({ ...base, types: typesOf(senior({ isActive: false })) }))).toBe(
            'DISCOUNT_TYPE_INACTIVE'
        );
        // ...unless the discount was already on the sale being edited.
        expect(
            codeOf(() =>
                applySaleDiscounts({ ...base, types: typesOf(senior({ isActive: false })), existingRefs: new Set(['a']) })
            )
        ).toBeNull();
        expect(codeOf(() => applySaleDiscounts({ ...base, types: typesOf(senior({ scope: DiscountScope.SALE })) }))).toBe(
            'DISCOUNT_SCOPE_NOT_ALLOWED'
        );
        expect(codeOf(() => applySaleDiscounts({ ...base, types: typesOf(senior()), isChannelSale: true }))).toBe(
            'DISCOUNT_NOT_ON_CHANNEL'
        );
        expect(
            codeOf(() => applySaleDiscounts({ ...base, lines: [{ qty: 1, unitPrice: 50 }], types: typesOf(senior()) }))
        ).toBe('DISCOUNT_UNUSED');
        expect(
            codeOf(() =>
                applySaleDiscounts({
                    ...base,
                    lines: [{ qty: 1, unitPrice: 50, discountRef: 'nope' }],
                    types: typesOf(senior()),
                })
            )
        ).toBe('DISCOUNT_REF_NOT_FOUND');
        expect(
            codeOf(() =>
                applySaleDiscounts({
                    ...base,
                    lines: [{ qty: 1, unitPrice: 50 }],
                    applications: [
                        { ref: 'x', discountTypeId: 'emp', scope: 'SALE' },
                        { ref: 'y', discountTypeId: 'emp', scope: 'SALE' },
                    ],
                    types: typesOf(employee()),
                })
            )
        ).toBe('MULTIPLE_SALE_DISCOUNTS');
    });
});
