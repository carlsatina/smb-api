import bcrypt from 'bcrypt';
import crypto from 'crypto';
import prisma from '../../lib/prisma';
import { createApp } from '../../src/app';
import request from 'supertest';
import { PlanTier, ProductType, Role } from '@prisma/client';

type CreateUserInput = {
    email?: string;
    password?: string;
    fullName?: string;
    subscriptionActive?: boolean;
    planTier?: PlanTier;
};

type CreateStoreInput = {
    name?: string;
    allowNegativeStock?: boolean;
    currency?: string;
    timezone?: string;
};

type CreateProductInput = {
    name?: string;
    type?: ProductType;
    price?: number;
    unit?: string;
};

const uniqueEmail = (prefix: string) =>
    `${prefix}-${crypto.randomUUID().slice(0, 8)}@example.com`;

export const createTestApp = () => request.agent(createApp());

export const resetDb = async () => {
    await prisma.saleItem.deleteMany();
    await prisma.purchaseReceiptItem.deleteMany();
    await prisma.purchaseOrderItem.deleteMany();
    await prisma.recipeLine.deleteMany();
    await prisma.inventoryMovement.deleteMany();
    await prisma.sale.deleteMany();
    await prisma.purchaseReceipt.deleteMany();
    await prisma.purchaseOrder.deleteMany();
    await prisma.recipe.deleteMany();
    await prisma.product.deleteMany();
    await prisma.ingredient.deleteMany();
    await prisma.supplier.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.storeInvite.deleteMany();
    await prisma.storeMember.deleteMany();
    await prisma.store.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
};

export const createUser = async (input: CreateUserInput = {}) => {
    const password = input.password ?? 'password123';
    const email = input.email ?? uniqueEmail('user');
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
        data: {
            email,
            passwordHash,
            fullName: input.fullName ?? 'Test User',
            subscriptionActive: input.subscriptionActive ?? true,
            planTier: input.planTier ?? PlanTier.STANDARD,
        },
    });

    return { user, password };
};

export const createStoreWithOwner = async (
    userId: string,
    input: CreateStoreInput = {},
    role: Role = Role.OWNER
) => {
    const store = await prisma.store.create({
        data: {
            name: input.name ?? 'Test Store',
            timezone: input.timezone ?? 'Asia/Manila',
            currency: input.currency ?? 'PHP',
            allowNegativeStock: input.allowNegativeStock ?? true,
            lowStockThreshold: 0,
            unitOptions: ['pc'],
            categoryOptions: ['General'],
        },
    });

    await prisma.storeMember.create({
        data: {
            storeId: store.id,
            userId,
            role,
        },
    });

    return store;
};

export const createProduct = async (storeId: string, input: CreateProductInput = {}) => {
    return prisma.product.create({
        data: {
            storeId,
            name: input.name ?? 'Test Product',
            type: input.type ?? ProductType.READY_MADE,
            price: input.price ?? 10,
            unit: input.unit ?? 'pc',
        },
    });
};

export const createSupplier = async (storeId: string, name?: string) => {
    return prisma.supplier.create({
        data: {
            storeId,
            name: name ?? 'Test Supplier',
        },
    });
};
