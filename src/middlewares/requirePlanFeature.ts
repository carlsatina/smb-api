import { NextFunction, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { getPlanConfig, PlanFeature } from '../config/plans';
import { AppError } from '../shared/errors';
import { AuthRequest } from './auth';

const featureLabels: Record<PlanFeature, string> = {
    ingredients: 'ingredients',
    recipes: 'recipes',
    purchaseOrders: 'purchase orders',
    importExport: 'import/export',
};

const getStoreOwnerPlan = async (storeId: string) => {
    const owner = await prisma.storeMember.findFirst({
        where: {
            storeId,
            role: Role.OWNER,
            deletedAt: null,
            store: {
                deletedAt: null,
            },
        },
        orderBy: {
            createdAt: 'asc',
        },
        select: {
            user: {
                select: {
                    planTier: true,
                    subscriptionActive: true,
                    grantedPlan: true,
                    grantedUntil: true,
                },
            },
        },
    });

    if (!owner?.user) {
        throw new AppError('OWNER_REQUIRED', 'Store owner not found.', 400);
    }

    return owner.user;
};

type PlanTier = import('@prisma/client').PlanTier;
const TIER_ORDER: Record<PlanTier, number> = { STARTER: 0, STANDARD: 1, GROWTH: 2 };

const resolveEffectivePlan = (user: {
    planTier: PlanTier;
    subscriptionActive: boolean;
    grantedPlan: PlanTier | null;
    grantedUntil: Date | null;
}): PlanTier => {
    const grantTier =
        user.grantedPlan && (!user.grantedUntil || user.grantedUntil > new Date())
            ? user.grantedPlan
            : null;
    const paidTier = user.subscriptionActive ? user.planTier : null;

    if (grantTier && paidTier) {
        return TIER_ORDER[grantTier] >= TIER_ORDER[paidTier] ? grantTier : paidTier;
    }
    return grantTier ?? paidTier ?? 'STARTER';
};

export const requirePlanFeature = (feature: PlanFeature) => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        const storeId = req.params.storeId;
        if (!storeId) {
            return next(new AppError('STORE_REQUIRED', 'Store is required', 400));
        }

        const owner = await getStoreOwnerPlan(storeId);
        const hasValidGrant =
            owner.grantedPlan && (!owner.grantedUntil || owner.grantedUntil > new Date());

        if (!hasValidGrant && !owner.subscriptionActive) {
            return next(
                new AppError('SUBSCRIPTION_REQUIRED', 'Active subscription required to access this feature.', 403)
            );
        }

        const effectiveTier = resolveEffectivePlan(owner);
        const plan = getPlanConfig(effectiveTier);
        if (!plan.features[feature]) {
            return next(
                new AppError(
                    'PLAN_LIMIT',
                    `${plan.label} plan does not include ${featureLabels[feature]}.`,
                    403
                )
            );
        }

        return next();
    };
};
