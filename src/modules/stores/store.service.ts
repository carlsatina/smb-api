import { AiProvider, Prisma, Role, Store, StoreType } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { getPlanConfig } from '../../config/plans';
import { AppError } from '../../shared/errors';
import { decryptSecret, encryptSecret } from '../../shared/crypto';
import { listAiModels, testAiConnection } from '../../shared/aiClient';
import { DEFAULT_CATEGORY_OPTIONS, DEFAULT_EXPENSE_CATEGORY_OPTIONS, DEFAULT_UNIT_OPTIONS } from './store.defaults';

// Maps a raw Store row to a client-safe shape. The encrypted AI API key is never
// exposed — only whether a key is configured and its last 4 characters.
const toStoreDto = (store: Store) => {
    const { aiApiKeyEncrypted, aiApiKeyLast4, ...rest } = store;
    return {
        ...rest,
        lowStockThreshold: Number(store.lowStockThreshold ?? 0),
        defaultTaxRate: Number(store.defaultTaxRate ?? 0),
        defaultDiscount: Number(store.defaultDiscount ?? 0),
        aiApiKeySet: Boolean(aiApiKeyEncrypted),
        aiApiKeyLast4: aiApiKeyLast4 ?? null,
    };
};

type CreateStoreInput = {
    name: string;
    storeType?: StoreType;
    timezone?: string;
    currency?: string;
    allowNegativeStock?: boolean;
    lowStockThreshold?: number;
    unitOptions?: string[];
    categoryOptions?: string[];
    expenseCategoryOptions?: string[];
    defaultTaxRate?: number;
    defaultDiscount?: number;
};

type UpdateStoreInput = {
    name?: string;
    storeType?: StoreType;
    timezone?: string;
    currency?: string;
    allowNegativeStock?: boolean;
    lowStockThreshold?: number;
    unitOptions?: string[];
    categoryOptions?: string[];
    expenseCategoryOptions?: string[];
    defaultTaxRate?: number;
    defaultDiscount?: number;
    cashierSalesHistoryLimit?: number | null;
    paymentMethods?: string[];
};

const normalizeOptions = (options: string[] | undefined, fallback: string[]) => {
    if (!options) return fallback;
    const normalized: string[] = [];
    options.forEach((option) => {
        const value = option.trim();
        if (!value) return;
        if (normalized.some((entry) => entry.toLowerCase() === value.toLowerCase())) return;
        normalized.push(value);
    });
    return normalized.length > 0 ? normalized : fallback;
};

export const storeService = {
    listStores: async (userId: string) => {
        const memberships = await prisma.storeMember.findMany({
            where: {
                userId,
                deletedAt: null,
                store: {
                    deletedAt: null,
                },
            },
            include: {
                store: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        // Get store IDs to find owners
        const storeIds = memberships.map((m) => m.store.id);

        // Find owners for all stores
        const ownerMemberships = await prisma.storeMember.findMany({
            where: {
                storeId: { in: storeIds },
                role: 'OWNER',
                deletedAt: null,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        planTier: true,
                        subscriptionActive: true,
                    },
                },
            },
        });

        // Map store ID to owner info
        const ownerByStoreId = new Map(
            ownerMemberships.map((om) => [
                om.storeId,
                {
                    planTier: om.user.planTier,
                    subscriptionActive: om.user.subscriptionActive,
                },
            ])
        );

        return memberships.map((membership) => {
            const owner = ownerByStoreId.get(membership.store.id);
            return {
                id: membership.store.id,
                name: membership.store.name,
                storeType: membership.store.storeType,
                timezone: membership.store.timezone,
                currency: membership.store.currency,
                allowNegativeStock: membership.store.allowNegativeStock,
                lowStockThreshold: Number(membership.store.lowStockThreshold ?? 0),
                unitOptions: membership.store.unitOptions,
                categoryOptions: membership.store.categoryOptions,
                expenseCategoryOptions: membership.store.expenseCategoryOptions,
                defaultTaxRate: Number(membership.store.defaultTaxRate ?? 0),
                defaultDiscount: Number(membership.store.defaultDiscount ?? 0),
                cashierSalesHistoryLimit: membership.store.cashierSalesHistoryLimit ?? null,
                paymentMethods: membership.store.paymentMethods,
                aiProvider: membership.store.aiProvider ?? null,
                aiModel: membership.store.aiModel ?? null,
                aiApiKeySet: Boolean(membership.store.aiApiKeyEncrypted),
                aiApiKeyLast4: membership.store.aiApiKeyLast4 ?? null,
                role: membership.role,
                ownerPlanTier: owner?.planTier ?? 'STARTER',
                ownerSubscriptionActive: owner?.subscriptionActive ?? false,
            };
        });
    },
    createStore: async (userId: string, input: CreateStoreInput) => {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { subscriptionActive: true, planTier: true, emailVerifiedAt: true },
        });

        if (!user) {
            throw new AppError('NOT_FOUND', 'User not found', 404);
        }

        if (!user.subscriptionActive) {
            throw new AppError('SUBSCRIPTION_REQUIRED', 'Active subscription required to create a store.', 403);
        }
        if (!user.emailVerifiedAt) {
            throw new AppError('EMAIL_NOT_VERIFIED', 'Verify your email to create a store.', 403);
        }

        const plan = getPlanConfig(user.planTier);
        const ownedStores = await prisma.storeMember.count({
            where: {
                userId,
                role: Role.OWNER,
                deletedAt: null,
                store: {
                    deletedAt: null,
                },
            },
        });

        if (ownedStores >= plan.maxStores) {
            throw new AppError(
                'PLAN_LIMIT',
                `${plan.label} plan allows up to ${plan.maxStores} store${plan.maxStores === 1 ? '' : 's'}.`,
                403
            );
        }

        const memberships = await prisma.storeMember.findMany({
            where: {
                userId,
                deletedAt: null,
            },
            select: {
                role: true,
            },
        });

        const hasOwnerRole = memberships.some((membership) => membership.role === Role.OWNER);
        if (memberships.length > 0 && !hasOwnerRole) {
            throw new AppError('OWNER_REQUIRED', 'Only owners can create new stores.', 403);
        }

        return prisma.$transaction(async (tx) => {
            const store = await tx.store.create({
                data: {
                    name: input.name,
                    storeType: input.storeType ?? StoreType.RETAIL,
                    timezone: input.timezone ?? 'Asia/Manila',
                    currency: input.currency ?? 'PHP',
                    allowNegativeStock: input.allowNegativeStock ?? false,
                    lowStockThreshold: input.lowStockThreshold ?? 0,
                    unitOptions: normalizeOptions(input.unitOptions, DEFAULT_UNIT_OPTIONS),
                    categoryOptions: normalizeOptions(input.categoryOptions, DEFAULT_CATEGORY_OPTIONS),
                    expenseCategoryOptions: normalizeOptions(input.expenseCategoryOptions, DEFAULT_EXPENSE_CATEGORY_OPTIONS),
                    defaultTaxRate: input.defaultTaxRate ?? 0,
                    defaultDiscount: input.defaultDiscount ?? 0,
                },
            });

            await tx.storeMember.create({
                data: {
                    storeId: store.id,
                    userId,
                    role: Role.OWNER,
                },
            });

            return toStoreDto(store);
        });
    },
    updateStore: async (storeId: string, input: UpdateStoreInput) => {
        const existing = await prisma.store.findFirst({
            where: {
                id: storeId,
                deletedAt: null,
            },
        });

        if (!existing) {
            return null;
        }

        const data: Prisma.StoreUpdateInput = {};
        if (input.name !== undefined) {
            data.name = input.name;
        }
        if (input.storeType !== undefined) {
            data.storeType = input.storeType;
        }
        if (input.timezone !== undefined) {
            data.timezone = input.timezone;
        }
        if (input.currency !== undefined) {
            data.currency = input.currency;
        }
        if (input.allowNegativeStock !== undefined) {
            data.allowNegativeStock = input.allowNegativeStock;
        }
        if (input.lowStockThreshold !== undefined) {
            data.lowStockThreshold = input.lowStockThreshold;
        }
        if (input.unitOptions !== undefined) {
            data.unitOptions = normalizeOptions(input.unitOptions, DEFAULT_UNIT_OPTIONS);
        }
        if (input.categoryOptions !== undefined) {
            data.categoryOptions = normalizeOptions(input.categoryOptions, DEFAULT_CATEGORY_OPTIONS);
        }
        if (input.expenseCategoryOptions !== undefined) {
            data.expenseCategoryOptions = normalizeOptions(input.expenseCategoryOptions, DEFAULT_EXPENSE_CATEGORY_OPTIONS);
        }
        if (input.defaultTaxRate !== undefined) {
            data.defaultTaxRate = input.defaultTaxRate;
        }
        if (input.defaultDiscount !== undefined) {
            data.defaultDiscount = input.defaultDiscount;
        }
        if (input.cashierSalesHistoryLimit !== undefined) {
            data.cashierSalesHistoryLimit = input.cashierSalesHistoryLimit;
        }
        if (input.paymentMethods !== undefined) {
            data.paymentMethods = input.paymentMethods;
        }

        const updated = await prisma.store.update({
            where: { id: storeId },
            data,
        });
        return toStoreDto(updated);
    },
    updateAiSettings: async (
        storeId: string,
        input: { aiProvider?: AiProvider | null; aiModel?: string | null; aiApiKey?: string | null }
    ) => {
        const existing = await prisma.store.findFirst({
            where: { id: storeId, deletedAt: null },
        });
        if (!existing) {
            return null;
        }

        const data: Prisma.StoreUpdateInput = {};
        if (input.aiProvider !== undefined) {
            data.aiProvider = input.aiProvider;
        }
        if (input.aiModel !== undefined) {
            const trimmed = input.aiModel?.trim();
            data.aiModel = trimmed ? trimmed : null;
        }
        // Write-only key: a provided non-empty value replaces it; empty/null clears
        // it; omitting the field entirely leaves the stored key untouched.
        if (input.aiApiKey !== undefined) {
            const key = input.aiApiKey?.trim();
            if (key) {
                data.aiApiKeyEncrypted = encryptSecret(key);
                data.aiApiKeyLast4 = key.slice(-4);
            } else {
                data.aiApiKeyEncrypted = null;
                data.aiApiKeyLast4 = null;
            }
        }

        const updated = await prisma.store.update({
            where: { id: storeId },
            data,
        });
        return toStoreDto(updated);
    },
    testAiConnection: async (storeId: string) => {
        const store = await prisma.store.findFirst({
            where: { id: storeId, deletedAt: null },
            select: { aiProvider: true, aiModel: true, aiApiKeyEncrypted: true },
        });
        if (!store) {
            throw new AppError('NOT_FOUND', 'Store not found', 404);
        }
        if (!store.aiProvider) {
            throw new AppError('AI_NOT_CONFIGURED', 'Select an AI provider before testing the connection.', 400);
        }
        if (!store.aiApiKeyEncrypted) {
            throw new AppError('AI_KEY_MISSING', 'Save an API key before testing the connection.', 400);
        }
        const apiKey = decryptSecret(store.aiApiKeyEncrypted);
        if (!apiKey) {
            throw new AppError('AI_KEY_UNREADABLE', 'The stored API key could not be decrypted. Re-enter and save it.', 400);
        }

        return testAiConnection(store.aiProvider, apiKey, store.aiModel);
    },
    listAiModels: async (storeId: string) => {
        const store = await prisma.store.findFirst({
            where: { id: storeId, deletedAt: null },
            select: { aiProvider: true, aiApiKeyEncrypted: true },
        });
        if (!store) {
            throw new AppError('NOT_FOUND', 'Store not found', 404);
        }
        if (!store.aiProvider) {
            throw new AppError('AI_NOT_CONFIGURED', 'Select an AI provider first.', 400);
        }
        if (!store.aiApiKeyEncrypted) {
            throw new AppError('AI_KEY_MISSING', 'Save an API key first.', 400);
        }
        const apiKey = decryptSecret(store.aiApiKeyEncrypted);
        if (!apiKey) {
            throw new AppError('AI_KEY_UNREADABLE', 'The stored API key could not be decrypted. Re-enter and save it.', 400);
        }

        return listAiModels(store.aiProvider, apiKey);
    },
    deleteStore: async (storeId: string) => {
        const existing = await prisma.store.findFirst({
            where: {
                id: storeId,
                deletedAt: null,
            },
        });

        if (!existing) {
            return null;
        }

        const now = new Date();
        await prisma.$transaction(async (tx) => {
            await tx.store.update({
                where: { id: storeId },
                data: { deletedAt: now },
            });

            await tx.storeMember.updateMany({
                where: {
                    storeId,
                    deletedAt: null,
                },
                data: {
                    deletedAt: now,
                },
            });
        });

        return existing;
    },
};
