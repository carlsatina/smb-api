import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../lib/prisma';
import { normalizeSubcategoryOptions, parseSubcategoryOptions, resolveSubcategory } from '../src/shared/subcategories';
import { productService } from '../src/modules/products/product.service';

vi.mock('../lib/prisma', () => ({
    default: {
        store: { findFirst: vi.fn() },
        product: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
        recipe: { findFirst: vi.fn() },
    },
}));

const prismaMock = vi.mocked(prisma, { deep: true });

describe('subcategory options helpers', () => {
    it('dedupes case-insensitively, trims, and drops unknown categories', () => {
        const result = normalizeSubcategoryOptions(
            { lemonade: [' The Original ', 'the original', 'Refreshers', ''], Ghost: ['X'] },
            ['Lemonade', 'Snacks']
        );
        expect(result).toEqual({ Lemonade: ['The Original', 'Refreshers'] });
    });

    it('ignores malformed JSON values', () => {
        expect(parseSubcategoryOptions(['a'] as never)).toEqual({});
        expect(parseSubcategoryOptions({ A: 'x', B: ['ok', 3] } as never)).toEqual({ B: ['ok'] });
    });

    it('resolves to the configured spelling regardless of case', () => {
        const options = { Lemonade: ['Signature Refreshers'] };
        expect(resolveSubcategory(options, 'lemonade', 'signature refreshers')).toBe('Signature Refreshers');
        expect(resolveSubcategory(options, 'Lemonade', 'Shakes')).toBeNull();
        expect(resolveSubcategory(options, 'Snacks', 'Signature Refreshers')).toBeNull();
    });
});

describe('product subcategory validation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.store.findFirst.mockResolvedValue({
            subcategoryOptions: { Lemonade: ['Signature Refreshers'] },
        } as never);
    });

    const base = { name: 'Mango Refresher', type: 'READY_MADE' as const, price: 75, unit: 'pcs', category: 'Lemonade' };

    it('rejects a subcategory not configured under the category', async () => {
        await expect(productService.create('s1', { ...base, subcategory: 'Shakes' })).rejects.toMatchObject({
            code: 'INVALID_SUBCATEGORY',
        });
        expect(prismaMock.product.create).not.toHaveBeenCalled();
    });

    it('rejects a subcategory without a category', async () => {
        await expect(
            productService.create('s1', { ...base, category: null, subcategory: 'Signature Refreshers' })
        ).rejects.toMatchObject({ code: 'SUBCATEGORY_REQUIRES_CATEGORY' });
    });

    it('saves the configured spelling', async () => {
        prismaMock.product.create.mockResolvedValue({ id: 'p1', recipe: null } as never);
        await productService.create('s1', { ...base, subcategory: 'signature refreshers' });
        expect(prismaMock.product.create.mock.calls[0]?.[0]?.data).toMatchObject({
            subcategory: 'Signature Refreshers',
        });
    });
});
