import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth';
import { requirePermission, requireStoreMember } from '../../middlewares/requirePermission';
import {
    archiveDiscountType,
    createDiscountType,
    listDiscountTypes,
    updateDiscountType,
} from './discountType.controller';

export const discountTypeRouter = Router({ mergeParams: true });

discountTypeRouter.use(authMiddleware);

// Every member can read them (the POS needs the list); changing them is a store setting.
discountTypeRouter.get('/', requireStoreMember(), listDiscountTypes);
discountTypeRouter.post('/', requirePermission('store.manage'), createDiscountType);
discountTypeRouter.patch('/:discountTypeId', requirePermission('store.manage'), updateDiscountType);
discountTypeRouter.delete('/:discountTypeId', requirePermission('store.manage'), archiveDiscountType);
