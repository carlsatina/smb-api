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
    exports: 'exports',
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

const resolveEffectivePlan = (user: {
    planTier: import('@prisma/client').PlanTier;
    grantedPlan: import('@prisma/client').PlanTier | null;
    grantedUntil: Date | null;
}) => {
    if (user.grantedPlan && (!user.grantedUntil || user.grantedUntil > new Date())) {
        return user.grantedPlan;
    }
    return user.planTier;
};

export const requirePlanFeature = (feature: PlanFeature) => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        const storeId = req.params.storeId;
        if (!storeId) {
            return next(new AppError('STORE_REQUIRED', 'Store is required', 400));
        }

        const owner = await getStoreOwnerPlan(storeId);
        if (!owner.subscriptionActive) {
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
