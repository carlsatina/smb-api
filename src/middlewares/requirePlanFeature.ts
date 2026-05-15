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
                },
            },
        },
    });

    if (!owner?.user) {
        throw new AppError('OWNER_REQUIRED', 'Store owner not found.', 400);
    }

    return owner.user;
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

        const plan = getPlanConfig(owner.planTier);
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
