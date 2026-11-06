import { Prisma } from '@prisma/client';

/** Store-level product subcategories, keyed by category name. Order is the display order. */
export type SubcategoryOptions = Record<string, string[]>;

const lower = (value: string) => value.trim().toLowerCase();

/** Defensive read of the Store.subcategoryOptions JSON column. */
export const parseSubcategoryOptions = (value: Prisma.JsonValue | null | undefined): SubcategoryOptions => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: SubcategoryOptions = {};
    Object.entries(value).forEach(([category, subs]) => {
        if (!Array.isArray(subs)) return;
        const list = subs.filter((sub): sub is string => typeof sub === 'string' && sub.trim().length > 0);
        if (list.length) result[category] = list;
    });
    return result;
};

/**
 * Trim and de-duplicate (case-insensitively) each list, and keep only categories
 * that exist in `categories`, re-keyed to the category's canonical spelling.
 */
export const normalizeSubcategoryOptions = (
    options: SubcategoryOptions,
    categories: string[]
): SubcategoryOptions => {
    const canonical = new Map(categories.map((category) => [lower(category), category.trim()]));
    const result: SubcategoryOptions = {};
    Object.entries(options).forEach(([category, subs]) => {
        const key = canonical.get(lower(category));
        if (!key || !Array.isArray(subs)) return;
        const list = result[key] ?? [];
        subs.forEach((sub) => {
            const value = typeof sub === 'string' ? sub.trim() : '';
            if (!value || list.some((entry) => lower(entry) === lower(value))) return;
            list.push(value);
        });
        if (list.length) result[key] = list;
    });
    return result;
};

export const getSubcategoriesFor = (options: SubcategoryOptions, category: string | null | undefined): string[] => {
    if (!category) return [];
    const match = Object.keys(options).find((key) => lower(key) === lower(category));
    return match ? options[match] : [];
};

/** Canonical spelling of `subcategory` under `category`, or null when it isn't configured. */
export const resolveSubcategory = (
    options: SubcategoryOptions,
    category: string | null | undefined,
    subcategory: string | null | undefined
): string | null => {
    if (!subcategory) return null;
    return getSubcategoriesFor(options, category).find((entry) => lower(entry) === lower(subcategory)) ?? null;
};
