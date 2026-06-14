import { PlanTier } from '@prisma/client';

export type PlanFeature = 'ingredients' | 'recipes' | 'purchaseOrders' | 'importExport' | 'expenses';

export type PlanConfig = {
    tier: PlanTier;
    label: string;
    maxStores: number;
    maxUsersPerStore: number;
    features: Record<PlanFeature, boolean>;
};

const planConfigs: Record<PlanTier, PlanConfig> = {
    STARTER: {
        tier: PlanTier.STARTER,
        label: 'Starter',
        maxStores: 1,
        maxUsersPerStore: 2,
        features: {
            ingredients: false,
            recipes: false,
            purchaseOrders: false,
            importExport: false,
            expenses: false,
        },
    },
    STANDARD: {
        tier: PlanTier.STANDARD,
        label: 'Standard',
        maxStores: 1,
        maxUsersPerStore: 5,
        features: {
            ingredients: true,
            recipes: true,
            purchaseOrders: true,
            importExport: true,
            expenses: true,
        },
    },
    GROWTH: {
        tier: PlanTier.GROWTH,
        label: 'Growth',
        maxStores: 3,
        maxUsersPerStore: 10,
        features: {
            ingredients: true,
            recipes: true,
            purchaseOrders: true,
            importExport: true,
            expenses: true,
        },
    },
};

export const getPlanConfig = (tier?: PlanTier | null) => {
    if (!tier) {
        return planConfigs.STARTER;
    }
    return planConfigs[tier] ?? planConfigs.STARTER;
};

export { planConfigs };
