import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import {
    IngredientCategory,
    ItemType,
    MovementType,
    PaymentMethod,
    PlanTier,
    Prisma,
    PrismaClient,
    ProductType,
    PurchaseOrderStatus,
    Role,
    SaleStatus,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DEFAULT_CATEGORY_OPTIONS, DEFAULT_UNIT_OPTIONS } from '../src/modules/stores/store.defaults';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
}

const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
});

const seedUserEmail = 'owner@example.com';
const starterOwnerEmail = 'starter_owner@example.com';
const starterStoreName = 'Starter Store';
const growthOwnerEmail = 'growth_owner@example.com';
const growthStoreName = 'Growth Store';
const roleSeedUsers = [
    { email: 'admin@example.com', fullName: 'Admin User', role: Role.ADMIN },
    { email: 'cashier@example.com', fullName: 'Cashier User', role: Role.CASHIER },
    { email: 'inventory@example.com', fullName: 'Inventory Manager', role: Role.INVENTORY_MANAGER },
    { email: 'viewer@example.com', fullName: 'Viewer User', role: Role.VIEWER },
];

const main = async () => {
    const defaultPasswordHash = await bcrypt.hash('password123', 10);

    const ensureUser = async (input: {
        email: string;
        fullName: string;
        subscriptionActive: boolean;
        planTier: PlanTier;
    }) => {
        let record = await prisma.user.findUnique({ where: { email: input.email } });
        if (!record) {
            record = await prisma.user.create({
                data: {
                    email: input.email,
                    passwordHash: defaultPasswordHash,
                    fullName: input.fullName,
                    emailVerifiedAt: new Date(),
                    subscriptionActive: input.subscriptionActive,
                    planTier: input.planTier,
                },
            });
            return record;
        }

        const updates: Prisma.UserUpdateInput = {};
        if (record.fullName !== input.fullName) {
            updates.fullName = input.fullName;
        }
        if (record.subscriptionActive !== input.subscriptionActive) {
            updates.subscriptionActive = input.subscriptionActive;
        }
        if (record.planTier !== input.planTier) {
            updates.planTier = input.planTier;
        }
        if (!record.emailVerifiedAt) {
            updates.emailVerifiedAt = new Date();
        }
        if (Object.keys(updates).length > 0) {
            record = await prisma.user.update({
                where: { id: record.id },
                data: updates,
            });
        }

        return record;
    };

    const ownerUser = await ensureUser({
        email: seedUserEmail,
        fullName: 'Owner User',
        subscriptionActive: true,
        planTier: PlanTier.STANDARD,
    });

    const roleUsers = await Promise.all(
        roleSeedUsers.map(async (entry) => ({
            ...entry,
            user: await ensureUser({
                email: entry.email,
                fullName: entry.fullName,
                subscriptionActive: true,
                planTier: PlanTier.STANDARD,
            }),
        }))
    );

    const starterOwner = await ensureUser({
        email: starterOwnerEmail,
        fullName: 'Starter Owner',
        subscriptionActive: true,
        planTier: PlanTier.STARTER,
    });

    const growthOwner = await ensureUser({
        email: growthOwnerEmail,
        fullName: 'Growth Owner',
        subscriptionActive: true,
        planTier: PlanTier.GROWTH,
    });

    let store = await prisma.store.findFirst({
        where: {
            name: 'Main Store',
            deletedAt: null,
        },
    });

    if (!store) {
        store = await prisma.store.create({
            data: {
                name: 'Main Store',
                timezone: 'Asia/Manila',
                currency: 'PHP',
                unitOptions: DEFAULT_UNIT_OPTIONS,
                categoryOptions: DEFAULT_CATEGORY_OPTIONS,
                allowNegativeStock: false,
                lowStockThreshold: 5,
            },
        });
    }

    await prisma.storeMember.upsert({
        where: {
            storeId_userId: {
                storeId: store.id,
                userId: ownerUser.id,
            },
        },
        update: {
            role: Role.OWNER,
            deletedAt: null,
        },
        create: {
            storeId: store.id,
            userId: ownerUser.id,
            role: Role.OWNER,
        },
    });

    for (const entry of roleUsers) {
        await prisma.storeMember.upsert({
            where: {
                storeId_userId: {
                    storeId: store.id,
                    userId: entry.user.id,
                },
            },
            update: {
                role: entry.role,
                deletedAt: null,
            },
            create: {
                storeId: store.id,
                userId: entry.user.id,
                role: entry.role,
            },
        });
    }

    let starterStore = await prisma.store.findFirst({
        where: {
            name: starterStoreName,
            deletedAt: null,
        },
    });

    if (!starterStore) {
        starterStore = await prisma.store.create({
            data: {
                name: starterStoreName,
                timezone: 'Asia/Manila',
                currency: 'PHP',
                unitOptions: DEFAULT_UNIT_OPTIONS,
                categoryOptions: DEFAULT_CATEGORY_OPTIONS,
                allowNegativeStock: false,
                lowStockThreshold: 3,
            },
        });
    }

    await prisma.storeMember.upsert({
        where: {
            storeId_userId: {
                storeId: starterStore.id,
                userId: starterOwner.id,
            },
        },
        update: {
            role: Role.OWNER,
            deletedAt: null,
        },
        create: {
            storeId: starterStore.id,
            userId: starterOwner.id,
            role: Role.OWNER,
        },
    });

    let growthStore = await prisma.store.findFirst({
        where: {
            name: growthStoreName,
            deletedAt: null,
        },
    });

    if (!growthStore) {
        growthStore = await prisma.store.create({
            data: {
                name: growthStoreName,
                timezone: 'Asia/Manila',
                currency: 'PHP',
                unitOptions: DEFAULT_UNIT_OPTIONS,
                categoryOptions: DEFAULT_CATEGORY_OPTIONS,
                allowNegativeStock: false,
                lowStockThreshold: 4,
            },
        });
    }

    await prisma.storeMember.upsert({
        where: {
            storeId_userId: {
                storeId: growthStore.id,
                userId: growthOwner.id,
            },
        },
        update: {
            role: Role.OWNER,
            deletedAt: null,
        },
        create: {
            storeId: growthStore.id,
            userId: growthOwner.id,
            role: Role.OWNER,
        },
    });

    await prisma.product.createMany({
        data: [
            {
                storeId: store.id,
                name: 'House Coffee',
                type: ProductType.READY_MADE,
                sku: 'COF-001',
                barcode: '0123456789012',
                price: 3.5,
                cost: 1.2,
                unit: 'cup',
                category: 'Beverages',
                active: true,
                lowStockThreshold: 10,
            },
            {
                storeId: store.id,
                name: 'Bottled Water',
                type: ProductType.READY_MADE,
                sku: 'WAT-001',
                barcode: '0123456789013',
                price: 1.5,
                cost: 0.5,
                unit: 'bottle',
                category: 'Beverages',
                active: true,
                lowStockThreshold: 20,
            },
            {
                storeId: store.id,
                name: 'Espresso',
                type: ProductType.READY_MADE,
                sku: 'ESP-001',
                barcode: '0123456789014',
                price: 2.75,
                cost: 0.95,
                unit: 'shot',
                category: 'Beverages',
                active: true,
                lowStockThreshold: 12,
            },
            {
                storeId: store.id,
                name: 'Cafe Latte',
                type: ProductType.READY_MADE,
                sku: 'LAT-001',
                barcode: '0123456789015',
                price: 4.25,
                cost: 1.6,
                unit: 'cup',
                category: 'Beverages',
                active: true,
                lowStockThreshold: 12,
            },
            {
                storeId: store.id,
                name: 'Cappuccino',
                type: ProductType.READY_MADE,
                sku: 'CAP-001',
                barcode: '0123456789016',
                price: 4.0,
                cost: 1.45,
                unit: 'cup',
                category: 'Beverages',
                active: true,
                lowStockThreshold: 12,
            },
            {
                storeId: store.id,
                name: 'Black Tea',
                type: ProductType.READY_MADE,
                sku: 'TEA-001',
                barcode: '0123456789017',
                price: 2.25,
                cost: 0.7,
                unit: 'cup',
                category: 'Beverages',
                active: true,
                lowStockThreshold: 15,
            },
            {
                storeId: store.id,
                name: 'Green Tea',
                type: ProductType.READY_MADE,
                sku: 'TEA-002',
                barcode: '0123456789018',
                price: 2.25,
                cost: 0.7,
                unit: 'cup',
                category: 'Beverages',
                active: true,
                lowStockThreshold: 15,
            },
            {
                storeId: store.id,
                name: 'Herbal Tea',
                type: ProductType.READY_MADE,
                sku: 'TEA-003',
                barcode: '0123456789019',
                price: 2.5,
                cost: 0.75,
                unit: 'cup',
                category: 'Beverages',
                active: true,
                lowStockThreshold: 15,
            },
            {
                storeId: store.id,
                name: 'Orange Juice',
                type: ProductType.READY_MADE,
                sku: 'JUI-001',
                barcode: '0123456789020',
                price: 3.0,
                cost: 1.1,
                unit: 'glass',
                category: 'Beverages',
                active: true,
                lowStockThreshold: 12,
            },
            {
                storeId: store.id,
                name: 'Apple Juice',
                type: ProductType.READY_MADE,
                sku: 'JUI-002',
                barcode: '0123456789021',
                price: 2.9,
                cost: 1.05,
                unit: 'glass',
                category: 'Beverages',
                active: true,
                lowStockThreshold: 12,
            },
            {
                storeId: store.id,
                name: 'Ham Sandwich',
                type: ProductType.READY_MADE,
                sku: 'SND-001',
                barcode: '0123456789022',
                price: 6.5,
                cost: 3.2,
                unit: 'each',
                category: 'Sandwiches',
                active: true,
                lowStockThreshold: 8,
            },
            {
                storeId: store.id,
                name: 'Chicken Sandwich',
                type: ProductType.READY_MADE,
                sku: 'SND-002',
                barcode: '0123456789023',
                price: 6.75,
                cost: 3.3,
                unit: 'each',
                category: 'Sandwiches',
                active: true,
                lowStockThreshold: 8,
            },
            {
                storeId: store.id,
                name: 'Veggie Sandwich',
                type: ProductType.READY_MADE,
                sku: 'SND-003',
                barcode: '0123456789024',
                price: 6.25,
                cost: 3.0,
                unit: 'each',
                category: 'Sandwiches',
                active: true,
                lowStockThreshold: 8,
            },
            {
                storeId: store.id,
                name: 'Pasta Salad',
                type: ProductType.READY_MADE,
                sku: 'PAST-001',
                barcode: '0123456789025',
                price: 5.5,
                cost: 2.6,
                unit: 'bowl',
                category: 'Meals',
                active: true,
                lowStockThreshold: 6,
            },
            {
                storeId: store.id,
                name: 'Caesar Salad',
                type: ProductType.READY_MADE,
                sku: 'SAL-001',
                barcode: '0123456789026',
                price: 5.75,
                cost: 2.8,
                unit: 'bowl',
                category: 'Meals',
                active: true,
                lowStockThreshold: 6,
            },
            {
                storeId: store.id,
                name: 'Greek Salad',
                type: ProductType.READY_MADE,
                sku: 'SAL-002',
                barcode: '0123456789027',
                price: 5.75,
                cost: 2.7,
                unit: 'bowl',
                category: 'Meals',
                active: true,
                lowStockThreshold: 6,
            },
            {
                storeId: store.id,
                name: 'Potato Chips',
                type: ProductType.READY_MADE,
                sku: 'SNK-001',
                barcode: '0123456789028',
                price: 1.75,
                cost: 0.7,
                unit: 'bag',
                category: 'Snacks',
                active: true,
                lowStockThreshold: 20,
            },
            {
                storeId: store.id,
                name: 'Chocolate Bar',
                type: ProductType.READY_MADE,
                sku: 'SNK-002',
                barcode: '0123456789029',
                price: 2.1,
                cost: 0.85,
                unit: 'bar',
                category: 'Snacks',
                active: true,
                lowStockThreshold: 20,
            },
            {
                storeId: store.id,
                name: 'Granola Bar',
                type: ProductType.READY_MADE,
                sku: 'SNK-003',
                barcode: '0123456789030',
                price: 1.95,
                cost: 0.8,
                unit: 'bar',
                category: 'Snacks',
                active: true,
                lowStockThreshold: 20,
            },
            {
                storeId: store.id,
                name: 'Cheesecake Slice',
                type: ProductType.READY_MADE,
                sku: 'DES-001',
                barcode: '0123456789031',
                price: 4.5,
                cost: 2.1,
                unit: 'slice',
                category: 'Desserts',
                active: true,
                lowStockThreshold: 10,
            },
            {
                storeId: store.id,
                name: 'Brownie',
                type: ProductType.READY_MADE,
                sku: 'DES-002',
                barcode: '0123456789032',
                price: 3.25,
                cost: 1.5,
                unit: 'piece',
                category: 'Desserts',
                active: true,
                lowStockThreshold: 10,
            },
            {
                storeId: store.id,
                name: 'Cookie',
                type: ProductType.READY_MADE,
                sku: 'DES-003',
                barcode: '0123456789033',
                price: 2.0,
                cost: 0.9,
                unit: 'piece',
                category: 'Desserts',
                active: true,
                lowStockThreshold: 12,
            },
            {
                storeId: store.id,
                name: 'Whole Milk',
                type: ProductType.READY_MADE,
                sku: 'MILK-001',
                barcode: '0123456789034',
                price: 3.0,
                cost: 1.4,
                unit: 'bottle',
                category: 'Dairy',
                active: true,
                lowStockThreshold: 12,
            },
            {
                storeId: store.id,
                name: 'Almond Milk',
                type: ProductType.READY_MADE,
                sku: 'MILK-002',
                barcode: '0123456789035',
                price: 3.5,
                cost: 1.6,
                unit: 'bottle',
                category: 'Dairy',
                active: true,
                lowStockThreshold: 12,
            },
            {
                storeId: store.id,
                name: 'Cola',
                type: ProductType.READY_MADE,
                sku: 'SODA-001',
                barcode: '0123456789036',
                price: 2.0,
                cost: 0.85,
                unit: 'can',
                category: 'Beverages',
                active: true,
                lowStockThreshold: 18,
            },
        ],
        skipDuplicates: true,
    });

    const ingredientCount = await prisma.ingredient.count({
        where: { storeId: store.id, deletedAt: null },
    });

    if (ingredientCount === 0) {
        await prisma.ingredient.createMany({
            data: [
                {
                    storeId: store.id,
                    name: 'Coffee Beans',
                    unit: 'kg',
                    category: IngredientCategory.RAW_MATERIAL,
                    costPerUnit: 14.5,
                    purchaseUnit: 'bag',
                    purchaseUnitSize: 5,
                    active: true,
                    lowStockThreshold: 2,
                },
                {
                    storeId: store.id,
                    name: 'Milk',
                    unit: 'liter',
                    category: IngredientCategory.RAW_MATERIAL,
                    costPerUnit: 1.1,
                    purchaseUnit: 'case',
                    purchaseUnitSize: 12,
                    active: true,
                    lowStockThreshold: 10,
                },
                {
                    storeId: store.id,
                    name: 'Sugar',
                    unit: 'kg',
                    category: IngredientCategory.RAW_MATERIAL,
                    costPerUnit: 0.9,
                    active: true,
                    lowStockThreshold: 5,
                },
                {
                    storeId: store.id,
                    name: 'Tea Leaves',
                    unit: 'kg',
                    category: IngredientCategory.RAW_MATERIAL,
                    costPerUnit: 12.5,
                    purchaseUnit: 'bag',
                    purchaseUnitSize: 1,
                    active: true,
                    lowStockThreshold: 2,
                },
                {
                    storeId: store.id,
                    name: 'Butter',
                    unit: 'kg',
                    category: IngredientCategory.RAW_MATERIAL,
                    costPerUnit: 6.5,
                    active: true,
                    lowStockThreshold: 3,
                },
                {
                    storeId: store.id,
                    name: 'Flour',
                    unit: 'kg',
                    category: IngredientCategory.RAW_MATERIAL,
                    costPerUnit: 1.4,
                    purchaseUnit: 'sack',
                    purchaseUnitSize: 25,
                    active: true,
                    lowStockThreshold: 6,
                },
                {
                    storeId: store.id,
                    name: 'Paper Cups',
                    unit: 'piece',
                    category: IngredientCategory.PACKAGING,
                    costPerUnit: 0.05,
                    purchaseUnit: 'sleeve',
                    purchaseUnitSize: 50,
                    active: true,
                    lowStockThreshold: 100,
                },
            ],
            skipDuplicates: true,
        });
    }

    const ingredients = await prisma.ingredient.findMany({
        where: { storeId: store.id, deletedAt: null },
        orderBy: { name: 'asc' },
    });

    // Recipe products (STANDARD plan feature)
    const recipeProductCount = await prisma.product.count({
        where: { storeId: store.id, type: ProductType.RECIPE, deletedAt: null },
    });

    if (recipeProductCount === 0 && ingredients.length >= 3) {
        const ingByName = new Map(ingredients.map((i) => [i.name, i]));

        const recipeSeeds = [
            {
                sku: 'RCP-LAT-001',
                name: 'Fresh Latte',
                price: 4.75,
                cost: 1.8,
                unit: 'cup',
                category: 'Beverages',
                lines: [
                    { ingredientName: 'Coffee Beans', qtyPerProductUnit: 0.018 },
                    { ingredientName: 'Milk', qtyPerProductUnit: 0.2 },
                    { ingredientName: 'Paper Cups', qtyPerProductUnit: 1 },
                ],
            },
            {
                sku: 'RCP-CAP-001',
                name: 'House Cappuccino',
                price: 4.5,
                cost: 1.65,
                unit: 'cup',
                category: 'Beverages',
                lines: [
                    { ingredientName: 'Coffee Beans', qtyPerProductUnit: 0.018 },
                    { ingredientName: 'Milk', qtyPerProductUnit: 0.12 },
                    { ingredientName: 'Paper Cups', qtyPerProductUnit: 1 },
                ],
            },
            {
                sku: 'RCP-CHA-001',
                name: 'Chai Latte',
                price: 4.25,
                cost: 1.5,
                unit: 'cup',
                category: 'Beverages',
                lines: [
                    { ingredientName: 'Tea Leaves', qtyPerProductUnit: 0.01 },
                    { ingredientName: 'Milk', qtyPerProductUnit: 0.2 },
                    { ingredientName: 'Sugar', qtyPerProductUnit: 0.01 },
                    { ingredientName: 'Paper Cups', qtyPerProductUnit: 1 },
                ],
            },
        ];

        for (const seed of recipeSeeds) {
            const recipeProduct = await prisma.product.create({
                data: {
                    storeId: store.id,
                    name: seed.name,
                    type: ProductType.RECIPE,
                    sku: seed.sku,
                    price: seed.price,
                    cost: seed.cost,
                    unit: seed.unit,
                    category: seed.category,
                    active: true,
                },
            });

            const validLines = seed.lines
                .filter((l) => ingByName.has(l.ingredientName))
                .map((l) => ({
                    ingredientId: ingByName.get(l.ingredientName)!.id,
                    qtyPerProductUnit: l.qtyPerProductUnit,
                }));

            await prisma.recipe.create({
                data: {
                    storeId: store.id,
                    productId: recipeProduct.id,
                    lines: { create: validLines },
                },
            });

            await prisma.inventoryMovement.create({
                data: {
                    storeId: store.id,
                    itemType: ItemType.PRODUCT,
                    itemId: recipeProduct.id,
                    qtyDelta: 50,
                    type: MovementType.STOCK_ADJUSTMENT,
                    note: 'Initial stock',
                    createdById: ownerUser.id,
                },
            });
        }
    }

    const supplierSeeds = [
        { name: 'Daily Farms', email: 'orders@dailyfarms.test', phone: '+1 555 0100' },
        { name: 'City Beverage Co', email: 'sales@citybev.test', phone: '+1 555 0101' },
        { name: 'Bakery & Co', email: 'hello@bakeryco.test', phone: '+1 555 0102' },
    ];

    for (const supplierSeed of supplierSeeds) {
        await prisma.supplier.upsert({
            where: {
                storeId_name: {
                    storeId: store.id,
                    name: supplierSeed.name,
                },
            },
            update: {
                email: supplierSeed.email,
                phone: supplierSeed.phone,
            },
            create: {
                storeId: store.id,
                name: supplierSeed.name,
                email: supplierSeed.email,
                phone: supplierSeed.phone,
            },
        });
    }

    const suppliers = await prisma.supplier.findMany({
        where: { storeId: store.id, deletedAt: null },
        orderBy: { name: 'asc' },
    });

    const purchaseOrderCount = await prisma.purchaseOrder.count({
        where: { storeId: store.id },
    });
    const receiptCount = await prisma.purchaseReceipt.count({
        where: { storeId: store.id },
    });

    if (purchaseOrderCount === 0 && receiptCount === 0) {
        const stockedProducts = await prisma.product.findMany({
            where: {
                storeId: store.id,
                deletedAt: null,
                type: ProductType.READY_MADE,
            },
            orderBy: { name: 'asc' },
        });

        if (stockedProducts.length > 0) {
            const byName = new Map(suppliers.map((supplier) => [supplier.name, supplier]));
            const primarySupplier = byName.get('City Beverage Co') ?? suppliers[0];
            const backupSupplier = byName.get('Daily Farms') ?? suppliers[1] ?? primarySupplier;
            const bakerySupplier = byName.get('Bakery & Co') ?? suppliers[2] ?? primarySupplier;

            const safeCost = (value: Prisma.Decimal | number | null | undefined, fallback: number) =>
                Number(value ?? fallback);
            const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);
            const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

            const pickProduct = (index: number) => stockedProducts[index] ?? stockedProducts[0];
            const pickIngredient = (index: number) => ingredients[index] ?? ingredients[0];

            const createPurchaseOrder = async (input: {
                supplierId?: string | null;
                supplierName?: string | null;
                status: PurchaseOrderStatus;
                expectedDate?: Date;
                items: Array<{
                    itemType: ItemType;
                    itemId: string;
                    qtyOrdered: number;
                    unitCost: number;
                }>;
            }) => {
                return prisma.purchaseOrder.create({
                    data: {
                        storeId: store.id,
                        supplierId: input.supplierId ?? null,
                        supplierName: input.supplierName ?? null,
                        status: input.status,
                        expectedDate: input.expectedDate,
                        items: {
                            create: input.items.map((item) => ({
                                itemType: item.itemType,
                                productId: item.itemType === ItemType.PRODUCT ? item.itemId : null,
                                ingredientId: item.itemType === ItemType.INGREDIENT ? item.itemId : null,
                                qtyOrdered: item.qtyOrdered,
                                qtyReceived: 0,
                                unitCost: item.unitCost,
                            })),
                        },
                    },
                });
            };

            const createReceipt = async (input: {
                purchaseOrderId?: string | null;
                invoiceNumber?: string;
                receivedAt: Date;
                status?: PurchaseOrderStatus;
                items: Array<{
                    itemType: ItemType;
                    itemId: string;
                    qtyReceived: number;
                    unitCost: number;
                }>;
            }) => {
                const totalCost = input.items.reduce(
                    (sum, item) => sum + item.qtyReceived * item.unitCost,
                    0
                );

                const receipt = await prisma.purchaseReceipt.create({
                    data: {
                        storeId: store.id,
                        purchaseOrderId: input.purchaseOrderId ?? null,
                        invoiceNumber: input.invoiceNumber ?? null,
                        receivedById: ownerUser.id,
                        receivedAt: input.receivedAt,
                        totalCost,
                        items: {
                            create: input.items.map((item) => ({
                                itemType: item.itemType,
                                productId: item.itemType === ItemType.PRODUCT ? item.itemId : null,
                                ingredientId: item.itemType === ItemType.INGREDIENT ? item.itemId : null,
                                qtyReceived: item.qtyReceived,
                                unitCost: item.unitCost,
                            })),
                        },
                    },
                });

                await prisma.inventoryMovement.createMany({
                    data: input.items.map((item) => ({
                        storeId: store.id,
                        itemType: item.itemType,
                        itemId: item.itemId,
                        qtyDelta: item.qtyReceived,
                        unitCost: item.unitCost,
                        type: MovementType.PURCHASE_RECEIPT,
                        referenceType: 'PurchaseReceipt',
                        referenceId: receipt.id,
                        createdById: ownerUser.id,
                    })),
                });

                if (input.purchaseOrderId) {
                    for (const item of input.items) {
                        const where: { purchaseOrderId: string; productId?: string; ingredientId?: string } = {
                            purchaseOrderId: input.purchaseOrderId,
                        };
                        if (item.itemType === ItemType.PRODUCT) {
                            where.productId = item.itemId;
                        } else {
                            where.ingredientId = item.itemId;
                        }
                        await prisma.purchaseOrderItem.updateMany({
                            where,
                            data: { qtyReceived: item.qtyReceived },
                        });
                    }

                    if (input.status) {
                        await prisma.purchaseOrder.update({
                            where: { id: input.purchaseOrderId },
                            data: { status: input.status },
                        });
                    }
                }

                return receipt;
            };

            await createPurchaseOrder({
                supplierId: primarySupplier?.id ?? null,
                status: PurchaseOrderStatus.SENT,
                expectedDate: daysFromNow(5),
                items: [
                    {
                        itemType: ItemType.PRODUCT,
                        itemId: pickProduct(0).id,
                        qtyOrdered: 40,
                        unitCost: safeCost(pickProduct(0).cost, 1.25),
                    },
                    {
                        itemType: ItemType.PRODUCT,
                        itemId: pickProduct(1).id,
                        qtyOrdered: 30,
                        unitCost: safeCost(pickProduct(1).cost, 1.1),
                    },
                    {
                        itemType: ItemType.PRODUCT,
                        itemId: pickProduct(2).id,
                        qtyOrdered: 24,
                        unitCost: safeCost(pickProduct(2).cost, 1.45),
                    },
                ],
            });

            const orderPartial = await createPurchaseOrder({
                supplierId: backupSupplier?.id ?? null,
                status: PurchaseOrderStatus.SENT,
                expectedDate: daysFromNow(2),
                items: [
                    {
                        itemType: ItemType.INGREDIENT,
                        itemId: pickIngredient(0).id,
                        qtyOrdered: 20,
                        unitCost: safeCost(pickIngredient(0).costPerUnit, 8.5),
                    },
                    {
                        itemType: ItemType.INGREDIENT,
                        itemId: pickIngredient(1).id,
                        qtyOrdered: 15,
                        unitCost: safeCost(pickIngredient(1).costPerUnit, 1.2),
                    },
                    {
                        itemType: ItemType.PRODUCT,
                        itemId: pickProduct(3).id,
                        qtyOrdered: 18,
                        unitCost: safeCost(pickProduct(3).cost, 2.25),
                    },
                ],
            });

            const orderReceived = await createPurchaseOrder({
                supplierId: bakerySupplier?.id ?? null,
                status: PurchaseOrderStatus.SENT,
                expectedDate: daysFromNow(1),
                items: [
                    {
                        itemType: ItemType.PRODUCT,
                        itemId: pickProduct(4).id,
                        qtyOrdered: 16,
                        unitCost: safeCost(pickProduct(4).cost, 2.1),
                    },
                    {
                        itemType: ItemType.INGREDIENT,
                        itemId: pickIngredient(2).id,
                        qtyOrdered: 10,
                        unitCost: safeCost(pickIngredient(2).costPerUnit, 0.95),
                    },
                ],
            });

            const orderCustom = await createPurchaseOrder({
                supplierName: 'Night Market Vendor',
                status: PurchaseOrderStatus.SENT,
                expectedDate: daysFromNow(3),
                items: [
                    {
                        itemType: ItemType.PRODUCT,
                        itemId: pickProduct(5).id,
                        qtyOrdered: 12,
                        unitCost: safeCost(pickProduct(5).cost, 1.8),
                    },
                    {
                        itemType: ItemType.INGREDIENT,
                        itemId: pickIngredient(3).id,
                        qtyOrdered: 18,
                        unitCost: safeCost(pickIngredient(3).costPerUnit, 4.2),
                    },
                ],
            });

            await createReceipt({
                purchaseOrderId: orderPartial.id,
                invoiceNumber: 'INV-1001',
                receivedAt: daysAgo(3),
                status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
                items: [
                    {
                        itemType: ItemType.INGREDIENT,
                        itemId: pickIngredient(0).id,
                        qtyReceived: 8,
                        unitCost: safeCost(pickIngredient(0).costPerUnit, 8.5),
                    },
                    {
                        itemType: ItemType.INGREDIENT,
                        itemId: pickIngredient(1).id,
                        qtyReceived: 15,
                        unitCost: safeCost(pickIngredient(1).costPerUnit, 1.2),
                    },
                    {
                        itemType: ItemType.PRODUCT,
                        itemId: pickProduct(3).id,
                        qtyReceived: 10,
                        unitCost: safeCost(pickProduct(3).cost, 2.25),
                    },
                ],
            });

            await createReceipt({
                purchaseOrderId: orderReceived.id,
                invoiceNumber: 'INV-1002',
                receivedAt: daysAgo(5),
                status: PurchaseOrderStatus.RECEIVED,
                items: [
                    {
                        itemType: ItemType.PRODUCT,
                        itemId: pickProduct(4).id,
                        qtyReceived: 16,
                        unitCost: safeCost(pickProduct(4).cost, 2.1),
                    },
                    {
                        itemType: ItemType.INGREDIENT,
                        itemId: pickIngredient(2).id,
                        qtyReceived: 10,
                        unitCost: safeCost(pickIngredient(2).costPerUnit, 0.95),
                    },
                ],
            });

            await createReceipt({
                purchaseOrderId: orderCustom.id,
                invoiceNumber: 'INV-1003',
                receivedAt: daysAgo(2),
                status: PurchaseOrderStatus.RECEIVED,
                items: [
                    {
                        itemType: ItemType.PRODUCT,
                        itemId: pickProduct(5).id,
                        qtyReceived: 12,
                        unitCost: safeCost(pickProduct(5).cost, 1.8),
                    },
                    {
                        itemType: ItemType.INGREDIENT,
                        itemId: pickIngredient(3).id,
                        qtyReceived: 18,
                        unitCost: safeCost(pickIngredient(3).costPerUnit, 4.2),
                    },
                ],
            });

            await createReceipt({
                invoiceNumber: 'INV-1004',
                receivedAt: daysAgo(1),
                items: [
                    {
                        itemType: ItemType.PRODUCT,
                        itemId: pickProduct(6).id,
                        qtyReceived: 6,
                        unitCost: safeCost(pickProduct(6).cost, 1.5),
                    },
                ],
            });

            // DRAFT order — being prepared, not yet sent
            await createPurchaseOrder({
                supplierId: primarySupplier?.id ?? null,
                status: PurchaseOrderStatus.DRAFT,
                expectedDate: daysFromNow(10),
                items: [
                    {
                        itemType: ItemType.PRODUCT,
                        itemId: pickProduct(7).id,
                        qtyOrdered: 20,
                        unitCost: safeCost(pickProduct(7).cost, 1.5),
                    },
                    {
                        itemType: ItemType.INGREDIENT,
                        itemId: pickIngredient(4).id,
                        qtyOrdered: 8,
                        unitCost: safeCost(pickIngredient(4).costPerUnit, 6.0),
                    },
                ],
            });

            // CANCELLED order
            await prisma.purchaseOrder.create({
                data: {
                    storeId: store.id,
                    supplierId: backupSupplier?.id ?? null,
                    status: PurchaseOrderStatus.CANCELLED,
                    expectedDate: daysAgo(7),
                    items: {
                        create: [
                            {
                                itemType: ItemType.PRODUCT,
                                productId: pickProduct(8).id,
                                qtyOrdered: 15,
                                qtyReceived: 0,
                                unitCost: safeCost(pickProduct(8).cost, 2.0),
                            },
                        ],
                    },
                },
            });
        }
    }

    // Seed sales data for reports
    const salesCount = await prisma.sale.count({
        where: { storeId: store.id },
    });

    if (salesCount === 0) {
        const allProducts = await prisma.product.findMany({
            where: {
                storeId: store.id,
                deletedAt: null,
                type: ProductType.READY_MADE,
                active: true,
            },
            orderBy: { name: 'asc' },
        });

        if (allProducts.length > 0) {
            const daysAgo = (days: number, hour = 12) => {
                const date = new Date();
                date.setDate(date.getDate() - days);
                date.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
                return date;
            };

            const randomProducts = (count: number) => {
                const shuffled = [...allProducts].sort(() => Math.random() - 0.5);
                return shuffled.slice(0, Math.min(count, shuffled.length));
            };

            const paymentMethods = [
                PaymentMethod.CASH,
                PaymentMethod.CARD,
                PaymentMethod.TRANSFER,
                PaymentMethod.GCASH,
                PaymentMethod.MAYA,
            ];
            let saleIndex = 0;
            let receiptCounter = 1001;

            const cashierUser = roleUsers.find((r) => r.role === Role.CASHIER)?.user ?? ownerUser;

            // Build a product map for name snapshots
            const productMap = new Map(allProducts.map((p) => [p.id, p]));

            const createSale = async (input: {
                finalizedAt: Date;
                cashierId?: string;
                receiptNumber?: number;
                items: Array<{
                    productId: string;
                    qty: number;
                    price: number;
                    cost: number;
                }>;
                discount?: number;
                tax?: number;
            }) => {
                const subtotal = input.items.reduce((sum, item) => sum + item.qty * item.price, 0);
                const discount = input.discount ?? 0;
                const tax = input.tax ?? 0;
                const total = subtotal - discount + tax;
                const paymentMethod = paymentMethods[saleIndex % paymentMethods.length];
                saleIndex++;

                const sale = await prisma.sale.create({
                    data: {
                        store: { connect: { id: store.id } },
                        cashier: { connect: { id: input.cashierId ?? ownerUser.id } },
                        status: SaleStatus.FINALIZED,
                        receiptNumber: input.receiptNumber ?? null,
                        paymentMethod,
                        subtotal,
                        discount,
                        tax,
                        total,
                        finalizedAt: input.finalizedAt,
                        items: {
                            create: input.items.map((item) => ({
                                product: { connect: { id: item.productId } },
                                qty: item.qty,
                                unitPrice: item.price,
                                discount: 0,
                                tax: 0,
                                total: item.qty * item.price,
                                nameSnapshot: productMap.get(item.productId)?.name ?? 'Unknown Product',
                            })),
                        },
                    },
                });

                // Create inventory movements for sold products
                await prisma.inventoryMovement.createMany({
                    data: input.items.map((item) => ({
                        storeId: store.id,
                        itemType: ItemType.PRODUCT,
                        itemId: item.productId,
                        qtyDelta: -item.qty,
                        unitCost: item.cost,
                        type: MovementType.SALE,
                        referenceType: 'Sale',
                        referenceId: sale.id,
                        createdById: input.cashierId ?? ownerUser.id,
                    })),
                });

                return sale;
            };

            // Create sales spread across the last 14 days with varying hours
            const salesPatterns = [
                // Today - busy day
                { daysBack: 0, salesCount: 8, peakHours: [9, 10, 12, 13, 14, 17, 18, 19] },
                // Yesterday - normal day
                { daysBack: 1, salesCount: 6, peakHours: [8, 10, 12, 14, 17, 19] },
                // 2 days ago - busy day
                { daysBack: 2, salesCount: 9, peakHours: [7, 9, 10, 11, 12, 13, 15, 18, 20] },
                // 3 days ago - slow day
                { daysBack: 3, salesCount: 4, peakHours: [10, 12, 15, 18] },
                // 4 days ago - normal
                { daysBack: 4, salesCount: 5, peakHours: [9, 11, 13, 16, 19] },
                // 5 days ago - busy
                { daysBack: 5, salesCount: 7, peakHours: [8, 10, 11, 13, 14, 17, 20] },
                // 6 days ago - slow
                { daysBack: 6, salesCount: 3, peakHours: [11, 14, 18] },
                // 7 days ago - normal
                { daysBack: 7, salesCount: 6, peakHours: [9, 10, 12, 15, 17, 19] },
                // 8 days ago
                { daysBack: 8, salesCount: 5, peakHours: [8, 11, 13, 16, 18] },
                // 9 days ago
                { daysBack: 9, salesCount: 7, peakHours: [9, 10, 12, 13, 15, 18, 20] },
                // 10 days ago
                { daysBack: 10, salesCount: 4, peakHours: [10, 12, 16, 19] },
                // 11 days ago
                { daysBack: 11, salesCount: 6, peakHours: [8, 10, 12, 14, 17, 19] },
                // 12 days ago
                { daysBack: 12, salesCount: 5, peakHours: [9, 11, 13, 16, 18] },
                // 13 days ago
                { daysBack: 13, salesCount: 8, peakHours: [7, 9, 11, 12, 14, 16, 18, 21] },
            ];

            for (const pattern of salesPatterns) {
                for (let i = 0; i < pattern.salesCount; i++) {
                    const hour = pattern.peakHours[i % pattern.peakHours.length];
                    const products = randomProducts(Math.floor(Math.random() * 3) + 1);
                    const items = products.map((product) => ({
                        productId: product.id,
                        qty: Math.floor(Math.random() * 3) + 1,
                        price: Number(product.price ?? 0),
                        cost: Number(product.cost ?? 0),
                    }));

                    const subtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
                    const applyDiscount = Math.random() > 0.8;
                    const discount = applyDiscount ? Math.round(subtotal * 0.1 * 100) / 100 : 0;

                    const rn = receiptCounter++;
                    await createSale({
                        finalizedAt: daysAgo(pattern.daysBack, hour),
                        cashierId: rn % 4 === 0 ? cashierUser.id : ownerUser.id,
                        receiptNumber: rn,
                        items,
                        discount,
                        tax: 0,
                    });
                }
            }

            // Create a few voided sales for the void report
            const voidedProducts = randomProducts(2);
            await prisma.sale.create({
                data: {
                    store: { connect: { id: store.id } },
                    cashier: { connect: { id: ownerUser.id } },
                    status: SaleStatus.VOIDED,
                    paymentMethod: PaymentMethod.CASH,
                    subtotal: Number(voidedProducts[0].price ?? 0) * 2,
                    discount: 0,
                    tax: 0,
                    total: Number(voidedProducts[0].price ?? 0) * 2,
                    voidedAt: daysAgo(1, 15),
                    items: {
                        create: [{
                            product: { connect: { id: voidedProducts[0].id } },
                            qty: 2,
                            unitPrice: Number(voidedProducts[0].price ?? 0),
                            discount: 0,
                            tax: 0,
                            total: Number(voidedProducts[0].price ?? 0) * 2,
                            nameSnapshot: voidedProducts[0].name,
                        }],
                    },
                },
            });

            // DRAFT sale — cart in progress, not yet finalised
            const draftProduct = allProducts[0];
            await prisma.sale.create({
                data: {
                    store: { connect: { id: store.id } },
                    cashier: { connect: { id: cashierUser.id } },
                    status: SaleStatus.DRAFT,
                    paymentMethod: PaymentMethod.CASH,
                    subtotal: Number(draftProduct.price ?? 0) * 3,
                    discount: 0,
                    tax: 0,
                    total: Number(draftProduct.price ?? 0) * 3,
                    items: {
                        create: [{
                            product: { connect: { id: draftProduct.id } },
                            qty: 3,
                            unitPrice: Number(draftProduct.price ?? 0),
                            discount: 0,
                            tax: 0,
                            total: Number(draftProduct.price ?? 0) * 3,
                            nameSnapshot: draftProduct.name,
                        }],
                    },
                },
            });

            console.log(`Created ${salesPatterns.reduce((sum, p) => sum + p.salesCount, 0)} sales, 1 voided sale, and 1 draft sale for reports`);
        }
    }

    // --- Starter Store products and sales ---
    const starterProductCount = await prisma.product.count({
        where: { storeId: starterStore.id, deletedAt: null },
    });
    if (starterProductCount === 0) {
        await prisma.product.createMany({
            data: [
                { storeId: starterStore.id, name: 'Americano', type: ProductType.READY_MADE, sku: 'ST-COF-001', price: 3.0, cost: 0.9, unit: 'cup', category: 'Beverages', active: true },
                { storeId: starterStore.id, name: 'Bottled Water', type: ProductType.READY_MADE, sku: 'ST-WAT-001', price: 1.5, cost: 0.5, unit: 'bottle', category: 'Beverages', active: true },
                { storeId: starterStore.id, name: 'Croissant', type: ProductType.READY_MADE, sku: 'ST-BKY-001', price: 2.5, cost: 1.0, unit: 'piece', category: 'Bakery', active: true },
                { storeId: starterStore.id, name: 'Granola Bar', type: ProductType.READY_MADE, sku: 'ST-SNK-001', price: 1.75, cost: 0.7, unit: 'bar', category: 'Snacks', active: true },
                { storeId: starterStore.id, name: 'Orange Juice', type: ProductType.READY_MADE, sku: 'ST-JUI-001', price: 2.75, cost: 1.0, unit: 'glass', category: 'Beverages', active: true },
            ],
            skipDuplicates: true,
        });
    }

    const starterSalesCount = await prisma.sale.count({ where: { storeId: starterStore.id } });
    if (starterSalesCount === 0) {
        const starterProducts = await prisma.product.findMany({
            where: { storeId: starterStore.id, deletedAt: null, active: true },
        });
        if (starterProducts.length > 0) {
            const daysAgoSt = (days: number, hour: number) => {
                const d = new Date();
                d.setDate(d.getDate() - days);
                d.setHours(hour, 30, 0, 0);
                return d;
            };
            let stReceipt = 2001;
            const stPayments = [PaymentMethod.CASH, PaymentMethod.GCASH];
            for (let day = 0; day < 7; day++) {
                const count = 3 + (day % 3);
                for (let i = 0; i < count; i++) {
                    const product = starterProducts[i % starterProducts.length];
                    const qty = (i % 2) + 1;
                    const price = Number(product.price ?? 0);
                    const total = qty * price;
                    const rn = stReceipt++;
                    await prisma.sale.create({
                        data: {
                            store: { connect: { id: starterStore.id } },
                            cashier: { connect: { id: starterOwner.id } },
                            status: SaleStatus.FINALIZED,
                            receiptNumber: rn,
                            paymentMethod: stPayments[rn % stPayments.length],
                            subtotal: total,
                            discount: 0,
                            tax: 0,
                            total,
                            finalizedAt: daysAgoSt(day, 9 + (i % 8) * 1),
                            items: {
                                create: [{ product: { connect: { id: product.id } }, qty, unitPrice: price, discount: 0, tax: 0, total, nameSnapshot: product.name }],
                            },
                        },
                    });
                }
            }
        }
    }

    // --- Growth Store products, ingredients, recipe, and sales ---
    const growthProductCount = await prisma.product.count({
        where: { storeId: growthStore.id, deletedAt: null },
    });
    if (growthProductCount === 0) {
        await prisma.product.createMany({
            data: [
                { storeId: growthStore.id, name: 'Flat White', type: ProductType.READY_MADE, sku: 'GR-COF-001', price: 5.0, cost: 1.9, unit: 'cup', category: 'Beverages', active: true },
                { storeId: growthStore.id, name: 'Cold Brew', type: ProductType.READY_MADE, sku: 'GR-COF-002', price: 5.5, cost: 2.1, unit: 'cup', category: 'Beverages', active: true },
                { storeId: growthStore.id, name: 'Sparkling Water', type: ProductType.READY_MADE, sku: 'GR-WAT-001', price: 2.0, cost: 0.7, unit: 'bottle', category: 'Beverages', active: true },
                { storeId: growthStore.id, name: 'Avocado Toast', type: ProductType.READY_MADE, sku: 'GR-FOOD-001', price: 8.5, cost: 3.5, unit: 'plate', category: 'Meals', active: true },
                { storeId: growthStore.id, name: 'Blueberry Muffin', type: ProductType.READY_MADE, sku: 'GR-BKY-001', price: 3.5, cost: 1.4, unit: 'piece', category: 'Bakery', active: true },
            ],
            skipDuplicates: true,
        });
    }

    const growthIngredientCount = await prisma.ingredient.count({ where: { storeId: growthStore.id } });
    if (growthIngredientCount === 0) {
        await prisma.ingredient.createMany({
            data: [
                { storeId: growthStore.id, name: 'Espresso Beans', unit: 'kg', category: IngredientCategory.RAW_MATERIAL, costPerUnit: 16.0, purchaseUnit: 'bag', purchaseUnitSize: 2, active: true, lowStockThreshold: 1 },
                { storeId: growthStore.id, name: 'Oat Milk', unit: 'liter', category: IngredientCategory.RAW_MATERIAL, costPerUnit: 1.8, purchaseUnit: 'case', purchaseUnitSize: 6, active: true, lowStockThreshold: 5 },
                { storeId: growthStore.id, name: 'Eco Cups', unit: 'piece', category: IngredientCategory.PACKAGING, costPerUnit: 0.08, purchaseUnit: 'sleeve', purchaseUnitSize: 50, active: true, lowStockThreshold: 100 },
            ],
            skipDuplicates: true,
        });
    }

    const growthRecipeCount = await prisma.product.count({
        where: { storeId: growthStore.id, type: ProductType.RECIPE, deletedAt: null },
    });
    if (growthRecipeCount === 0) {
        const growthIngs = await prisma.ingredient.findMany({ where: { storeId: growthStore.id, deletedAt: null } });
        const gIngByName = new Map(growthIngs.map((i) => [i.name, i]));
        if (growthIngs.length >= 2) {
            const oatLatte = await prisma.product.create({
                data: { storeId: growthStore.id, name: 'Oat Milk Latte', type: ProductType.RECIPE, sku: 'GR-RCP-001', price: 5.75, cost: 2.2, unit: 'cup', category: 'Beverages', active: true },
            });
            const gLines = [
                { ingredientName: 'Espresso Beans', qtyPerProductUnit: 0.018 },
                { ingredientName: 'Oat Milk', qtyPerProductUnit: 0.25 },
                { ingredientName: 'Eco Cups', qtyPerProductUnit: 1 },
            ]
                .filter((l) => gIngByName.has(l.ingredientName))
                .map((l) => ({ ingredientId: gIngByName.get(l.ingredientName)!.id, qtyPerProductUnit: l.qtyPerProductUnit }));
            await prisma.recipe.create({
                data: { storeId: growthStore.id, productId: oatLatte.id, lines: { create: gLines } },
            });
        }
    }

    const growthSalesCount = await prisma.sale.count({ where: { storeId: growthStore.id } });
    if (growthSalesCount === 0) {
        const growthProducts = await prisma.product.findMany({
            where: { storeId: growthStore.id, deletedAt: null, active: true, type: ProductType.READY_MADE },
        });
        if (growthProducts.length > 0) {
            const daysAgoGr = (days: number, hour: number) => {
                const d = new Date();
                d.setDate(d.getDate() - days);
                d.setHours(hour, 15, 0, 0);
                return d;
            };
            let grReceipt = 3001;
            const grPayments = [PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.GCASH, PaymentMethod.MAYA];
            for (let day = 0; day < 7; day++) {
                const count = 4 + (day % 4);
                for (let i = 0; i < count; i++) {
                    const product = growthProducts[i % growthProducts.length];
                    const qty = (i % 2) + 1;
                    const price = Number(product.price ?? 0);
                    const total = qty * price;
                    const rn = grReceipt++;
                    await prisma.sale.create({
                        data: {
                            store: { connect: { id: growthStore.id } },
                            cashier: { connect: { id: growthOwner.id } },
                            status: SaleStatus.FINALIZED,
                            receiptNumber: rn,
                            paymentMethod: grPayments[rn % grPayments.length],
                            subtotal: total,
                            discount: 0,
                            tax: 0,
                            total,
                            finalizedAt: daysAgoGr(day, 8 + (i % 10)),
                            items: {
                                create: [{ product: { connect: { id: product.id } }, qty, unitPrice: price, discount: 0, tax: 0, total, nameSnapshot: product.name }],
                            },
                        },
                    });
                }
            }
        }
    }
};

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
