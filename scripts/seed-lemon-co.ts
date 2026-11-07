import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import {
    ExpenseSource,
    IngredientCategory,
    ItemType,
    MovementType,
    OrderType,
    PaymentMethod,
    Prisma,
    PrismaClient,
    ProductType,
    Role,
    SaleStatus,
    StoreType,
    DailyInventoryReportType,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL is not set in environment');
}

const defaultPrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
});

interface IngredientDef {
    unit: string;
    category: IngredientCategory;
    costPerUnit: number;
    lowStockThreshold: number;
    purchaseUnit?: string;
    purchaseUnitSize?: number;
}

interface RecipeLineDef {
    ingredientName: string;
    qty: number;
}

interface ProductDef {
    name: string;
    category: string;
    size: string;
    variant: string | null;
    sku: string;
    type: ProductType;
    price: number;
    cost?: number;
    recipeLines: RecipeLineDef[];
}

// Size tier -> product subcategory (shown as the second row of POS filters).
const SIZE_SUBCATEGORY: Record<string, string> = {
    Regular: 'Regular/12oz',
    Grande: 'Grande/16oz',
    Supreme: 'Supreme/22oz',
    'Supreme XL': 'SupremeXL/1L',
};
const SIZE_ORDER = ['Regular', 'Grande', 'Supreme', 'Supreme XL'];

// Grab sells only the larger cups, at store price +25% rounded to the peso.
const GRAB_CHANNEL = {
    key: 'GRAB',
    name: 'Grab',
    markupPercent: 25,
    rounding: 'NEAREST_1',
    alwaysTakeout: true,
    active: true,
};
const GRAB_SIZES = new Set(['Supreme', 'Supreme XL']);

/** Per-category subcategory lists, smallest size first, only sizes the category has. */
const buildSubcategoryOptions = (products: ProductDef[]): Record<string, string[]> => {
    const sizesByCategory = new Map<string, Set<string>>();
    products.forEach((product) => {
        if (!SIZE_SUBCATEGORY[product.size]) return;
        if (!sizesByCategory.has(product.category)) sizesByCategory.set(product.category, new Set());
        sizesByCategory.get(product.category)!.add(product.size);
    });
    return Object.fromEntries(
        Array.from(sizesByCategory, ([category, sizes]) => [
            category,
            SIZE_ORDER.filter((size) => sizes.has(size)).map((size) => SIZE_SUBCATEGORY[size]),
        ])
    );
};

interface DeliveryDef {
    date: string;
    ingredientName: string;
    qty: number;
}

interface DailySoldItem {
    productName: string;
    price: number;
    cashQty: number;
    cashAmount: number;
    ewalletQty: number;
    ewalletAmount: number;
    grabQty: number;
    grabAmount: number;
    seniorQty: number;
    seniorAmount: number;
    totalQty: number;
    totalAmount: number;
}

interface InventoryRecordItem {
    name: string;
    usedPortions?: number;
    used: number;
    start: number;
    in: number;
    end: number;
}

interface DailyRecord {
    date: string;
    summary: Record<string, number>;
    soldItems: DailySoldItem[];
    totalSalesCalculated: number;
    inventory: {
        lemon: {
            start: number;
            in: number;
            used: number;
            end: number;
        };
        flavors: InventoryRecordItem[];
        supplies: InventoryRecordItem[];
    };
}

interface LemonCoDataset {
    company: {
        name: string;
        timezone: string;
        currency: string;
        storeType: StoreType;
    };
    ingredients: Record<string, IngredientDef>;
    products: ProductDef[];
    deliveries: DeliveryDef[];
    dailyData: DailyRecord[];
}

export const seedLemonCo = async (customPrisma?: PrismaClient) => {
    const prisma = customPrisma ?? defaultPrisma;
    console.log('🍋 Starting Lemon Co. data generation for October 2026...');

    // 1. Load dataset
    const jsonPath = path.join(__dirname, 'data', 'lemon-co-oct-2026.json');
    if (!fs.existsSync(jsonPath)) {
        throw new Error(`Data file not found at ${jsonPath}. Run extract-lemon-co.py first.`);
    }

    const rawData = fs.readFileSync(jsonPath, 'utf8');
    const dataset: LemonCoDataset = JSON.parse(rawData);
    const subcategoryOptions = buildSubcategoryOptions(dataset.products);

    // 2. Ensure Users (Owner & Cashier)
    const defaultPasswordHash = await bcrypt.hash('password123', 10);

    const ensureUser = async (email: string, fullName: string, role: Role = Role.OWNER) => {
        let user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            user = await prisma.user.create({
                data: {
                    email,
                    passwordHash: defaultPasswordHash,
                    fullName,
                    emailVerifiedAt: new Date(),
                },
            });
            console.log(`Created user ${email} (${fullName})`);
        }
        return user;
    };

    const ownerUser = await ensureUser('owner@example.com', 'Lemon Co. Owner', Role.OWNER);
    const cashierUser = await ensureUser('cashier@example.com', 'Lemon Co. Cashier', Role.CASHIER);
    const adminUser = await ensureUser('admin@example.com', 'Admin User', Role.ADMIN);

    // 3. Ensure Store 'Lemon Co.'
    let store = await prisma.store.findFirst({
        where: {
            name: dataset.company.name,
            deletedAt: null,
        },
    });

    if (!store) {
        store = await prisma.store.create({
            data: {
                name: dataset.company.name,
                storeType: dataset.company.storeType || StoreType.RETAIL,
                timezone: dataset.company.timezone || 'Asia/Manila',
                currency: dataset.company.currency || 'PHP',
                unitOptions: ['cup', 'serving', 'pc', 'g', 'kg', 'ml', 'L', 'pack', 'bottle', 'gal'],
                categoryOptions: [
                    'The Original',
                    'Signature Refreshers',
                    'Premium Blends',
                    'Frosty Lemonade Shakes',
                    'Hot Drinks',
                    'Add-ons',
                ],
                subcategoryOptions,
                salesChannels: [GRAB_CHANNEL],
                expenseCategoryOptions: ['Food Allowance', 'Store Expenses', 'Supplies', 'Utilities'],
                paymentMethods: ['CASH', 'CARD', 'TRANSFER', 'GCASH', 'MAYA', 'OTHER'],
                allowNegativeStock: false,
                lowStockThreshold: 10,
            },
        });
        console.log(`Created store "${store.name}" (ID: ${store.id})`);
    } else {
        console.log(`Found existing store "${store.name}" (ID: ${store.id}). Resetting October 2026 data...`);
        await prisma.store.update({
            where: { id: store.id },
            data: {
                categoryOptions: [
                    'The Original',
                    'Signature Refreshers',
                    'Premium Blends',
                    'Frosty Lemonade Shakes',
                    'Hot Drinks',
                    'Add-ons',
                ],
                subcategoryOptions,
                salesChannels: [GRAB_CHANNEL],
            },
        });
        // Clean existing October data idempotently
        await prisma.sale.deleteMany({ where: { storeId: store.id } });
        await prisma.dailySalesEntry.deleteMany({ where: { storeId: store.id } });
        await prisma.dailyInventoryReport.deleteMany({ where: { storeId: store.id } });
        await prisma.expense.deleteMany({ where: { storeId: store.id } });
        await prisma.inventoryMovement.deleteMany({ where: { storeId: store.id } });
        await prisma.recipe.deleteMany({ where: { storeId: store.id } });
        await prisma.product.deleteMany({ where: { storeId: store.id } });
        await prisma.ingredient.deleteMany({ where: { storeId: store.id } });
    }

    // 4. Ensure Store Memberships
    const ensureMember = async (userId: string, role: Role) => {
        await prisma.storeMember.upsert({
            where: {
                storeId_userId: {
                    storeId: store.id,
                    userId,
                },
            },
            update: { role, deletedAt: null },
            create: {
                storeId: store.id,
                userId,
                role,
            },
        });
    };

    await ensureMember(ownerUser.id, Role.OWNER);
    await ensureMember(cashierUser.id, Role.CASHIER);
    await ensureMember(adminUser.id, Role.ADMIN);

    // 5. Create Ingredients
    console.log(`Creating ${Object.keys(dataset.ingredients).length} ingredients...`);
    const ingredientMap = new Map<string, string>(); // name -> id

    for (const [name, def] of Object.entries(dataset.ingredients)) {
        const ing = await prisma.ingredient.create({
            data: {
                storeId: store.id,
                name,
                unit: def.unit,
                category: def.category,
                costPerUnit: def.costPerUnit,
                lowStockThreshold: def.lowStockThreshold,
                purchaseUnit: def.purchaseUnit,
                purchaseUnitSize: def.purchaseUnitSize,
                active: true,
            },
        });
        ingredientMap.set(name, ing.id);
    }

    // 6. Log Day 1 Starting Inventory
    console.log('Logging starting inventory (Day 1: 2026-10-01)...');
    const day1 = dataset.dailyData[0];
    const initialMovements: Prisma.InventoryMovementCreateManyInput[] = [];

    // Fresh Lemon initial stock
    if (day1.inventory.lemon.start > 0 && ingredientMap.has('Fresh Lemon')) {
        initialMovements.push({
            storeId: store.id,
            itemType: ItemType.INGREDIENT,
            itemId: ingredientMap.get('Fresh Lemon')!,
            qtyDelta: day1.inventory.lemon.start,
            unitCost: dataset.ingredients['Fresh Lemon']?.costPerUnit ?? null,
            type: MovementType.STOCK_ADJUSTMENT,
            note: 'Oct 2026 Opening stock: Fresh Lemon',
            createdById: ownerUser.id,
            createdAt: new Date('2026-10-01T07:00:00+08:00'),
        });
    }

    // Flavors initial stock
    const flavorToIngredient: Record<string, string> = {
        'MANGO': 'Mango Puree',
        'WATERMELON': 'Watermelon Flavor',
        'CUCUMBER': 'Cucumber Flavor',
        'GINGER': 'Ginger Flavor',
        'HONEY': 'Pure Honey',
        'STRAWBERRY': 'Strawberry Flavor',
        'YAKULT': 'Yakult',
        'WATERMELON SOUR': 'Watermelon Sour',
        'BLUE LEMONADE': 'Blue Lemonade',
        'GUYABANO': 'Guyabano',
        'MANGO PINEAPPLE': 'Mango Pineapple',
        'MONSTER LEMONADE': 'Monster Energy',
        'ORANGE LEMONADE': 'Orange',
        'DRAGONFRUIT LEMONADE': 'Dragonfruit',
        'POWDERED MILK': 'Powdered Milk',
    };

    for (const f of day1.inventory.flavors) {
        const mappedIng = flavorToIngredient[f.name.toUpperCase()] || f.name;
        if (f.start > 0 && ingredientMap.has(mappedIng)) {
            initialMovements.push({
                storeId: store.id,
                itemType: ItemType.INGREDIENT,
                itemId: ingredientMap.get(mappedIng)!,
                qtyDelta: f.start,
                unitCost: dataset.ingredients[mappedIng]?.costPerUnit ?? null,
                type: MovementType.STOCK_ADJUSTMENT,
                note: `Oct 2026 Opening stock: ${mappedIng}`,
                createdById: ownerUser.id,
                createdAt: new Date('2026-10-01T07:00:00+08:00'),
            });
        }
    }

    // Supplies initial stock
    const supplyToIngredient: Record<string, string> = {
        '12 OZ CUPS': '12 OZ Cold Cup',
        '22 OZ CUPS': '22 OZ Cold Cup',
        '1 LITER': '1 Liter Cup / Bottle',
        '12 OZ HOT': '12 OZ Hot Cup',
        '16 OZ CUPS': '16 OZ Cold Cup',
        'STRAW': 'Regular Straw',
        'WSS': 'White Sugar',
        'BSS': 'Brown Sugar',
        'WATER': 'Purified Water',
        'TOTE BAGS': 'Tote Bag',
        'TISSUE': 'Tissue',
        'GLOVES': 'Food Prep Gloves',
        'TRASH BAG': 'Trash Bag',
        '90 mm LIDS': '90mm Flat Lid',
        '90 mm DOME LIDS': '90mm Dome Lid',
        '95 mm DOME LIDS': '95mm Dome Lid',
        'BOBA STRAW': 'Boba Straw',
        '95 mm PLASTIC LIDS': '95mm Flat / Plastic Lid',
        'TO- SOLO': 'Takeout Solo Bag',
        'TO- DUO': 'Takeout Duo Bag',
        'THERMAL': 'Thermal Bag',
    };

    for (const s of day1.inventory.supplies) {
        const mappedIng = supplyToIngredient[s.name] || s.name;
        if (s.start > 0 && ingredientMap.has(mappedIng)) {
            const isSugar = mappedIng === 'White Sugar' || mappedIng === 'Brown Sugar';
            const qty = isSugar ? s.start * 1000 : s.start;
            initialMovements.push({
                storeId: store.id,
                itemType: ItemType.INGREDIENT,
                itemId: ingredientMap.get(mappedIng)!,
                qtyDelta: qty,
                unitCost: dataset.ingredients[mappedIng]?.costPerUnit ?? null,
                type: MovementType.STOCK_ADJUSTMENT,
                note: `Oct 2026 Opening stock: ${mappedIng}`,
                createdById: ownerUser.id,
                createdAt: new Date('2026-10-01T07:00:00+08:00'),
            });
        }
    }

    if (initialMovements.length > 0) {
        await prisma.inventoryMovement.createMany({ data: initialMovements });
    }

    // 7. Record Restocks / Deliveries across the month
    console.log(`Recording ${dataset.deliveries.length} restock deliveries...`);
    const deliveryMovements: Prisma.InventoryMovementCreateManyInput[] = [];
    for (const del of dataset.deliveries) {
        if (ingredientMap.has(del.ingredientName) && del.qty !== 0) {
            const isSugar = del.ingredientName === 'White Sugar' || del.ingredientName === 'Brown Sugar';
            const qty = isSugar ? del.qty * 1000 : del.qty;
            deliveryMovements.push({
                storeId: store.id,
                itemType: ItemType.INGREDIENT,
                itemId: ingredientMap.get(del.ingredientName)!,
                qtyDelta: qty,
                unitCost: dataset.ingredients[del.ingredientName]?.costPerUnit ?? null,
                type: del.qty > 0 ? MovementType.PURCHASE_RECEIPT : MovementType.STOCK_ADJUSTMENT,
                note: del.qty > 0 ? `Restock delivery (${del.ingredientName})` : `Stock adjustment (${del.ingredientName})`,
                createdById: ownerUser.id,
                createdAt: new Date(`${del.date}T08:00:00+08:00`),
            });
        }
    }
    if (deliveryMovements.length > 0) {
        await prisma.inventoryMovement.createMany({ data: deliveryMovements });
    }

    // 8. Create Products & Recipes
    console.log(`Creating ${dataset.products.length} products and recipes...`);
    const productMap = new Map<string, { id: string; name: string; price: number; cost: number }>();

    for (const p of dataset.products) {
        // Calculate estimated product unit cost from recipe lines
        let estimatedCost = 0;
        for (const rl of p.recipeLines) {
            const ingDef = dataset.ingredients[rl.ingredientName];
            if (ingDef) {
                estimatedCost += ingDef.costPerUnit * rl.qty;
            }
        }

        const costToUse = p.cost != null && p.cost > 0
            ? p.cost
            : (estimatedCost > 0 ? Number(estimatedCost.toFixed(2)) : 15.00);

        const product = await prisma.product.create({
            data: {
                storeId: store.id,
                name: p.name,
                type: p.type,
                sku: p.sku,
                price: p.price,
                cost: costToUse,
                unit: 'cup',
                category: p.category,
                subcategory: SIZE_SUBCATEGORY[p.size] ?? null,
                unavailableChannels: GRAB_SIZES.has(p.size) ? [] : [GRAB_CHANNEL.key],
                active: true,
                lowStockThreshold: 10,
            },
        });

        productMap.set(p.name, {
            id: product.id,
            name: product.name,
            price: Number(product.price),
            cost: Number(product.cost ?? 0),
        });

        // Create Recipe if recipeLines exist
        if (p.recipeLines.length > 0) {
            const validLines = p.recipeLines
                .filter((line) => ingredientMap.has(line.ingredientName))
                .map((line) => ({
                    ingredientId: ingredientMap.get(line.ingredientName)!,
                    qtyPerProductUnit: line.qty,
                }));

            if (validLines.length > 0) {
                await prisma.recipe.create({
                    data: {
                        storeId: store.id,
                        productId: product.id,
                        lines: { create: validLines },
                    },
                });
            }
        }
    }

    // 9. Generate Daily Sales, Transactions, Inventory Reports, Expenses for all 31 Days
    console.log(`Processing ${dataset.dailyData.length} daily business records (Oct 1 - Oct 31)...`);
    let nextReceiptNumber = 10001;

    for (let dayIdx = 0; dayIdx < dataset.dailyData.length; dayIdx++) {
        const day = dataset.dailyData[dayIdx];
        const dateStr = day.date;
        const [y, m, d] = dateStr.split('-').map(Number);
        const dateObj = new Date(Date.UTC(y, m - 1, d));

        // Channel groupings
        type ChannelType = 'CASH' | 'EWALLET' | 'GRAB' | 'SENIOR';
        const channels: ChannelType[] = ['CASH', 'EWALLET', 'GRAB', 'SENIOR'];

        for (const channel of channels) {
            const channelItems = day.soldItems.filter((item) => {
                if (channel === 'CASH') return item.cashQty > 0;
                if (channel === 'EWALLET') return item.ewalletQty > 0;
                if (channel === 'GRAB') return item.grabQty > 0;
                if (channel === 'SENIOR') return item.seniorQty > 0;
                return false;
            });

            if (channelItems.length === 0) continue;

            let paymentMethod: PaymentMethod = PaymentMethod.CASH;
            let orderType: OrderType = OrderType.DINE_IN;
            if (channel === 'EWALLET' || channel === 'GRAB') paymentMethod = PaymentMethod.GCASH;
            if (channel === 'GRAB') {
                orderType = OrderType.TAKEOUT;
            }

            // Split into transactions if many items sold, or group nicely
            // For realism, let's create 2 to 6 realistic transactions per channel throughout the day
            const chunkCount = Math.min(channelItems.length, channel === 'GRAB' ? 2 : 4);
            const itemsPerChunk = Math.ceil(channelItems.length / chunkCount);

            for (let c = 0; c < chunkCount; c++) {
                const chunk = channelItems.slice(c * itemsPerChunk, (c + 1) * itemsPerChunk);
                if (chunk.length === 0) continue;

                // Operating hours: 10:00 AM to 8:30 PM in Asia/Manila (+08:00)
                const hour = 10 + Math.floor((c * 9) / Math.max(1, chunkCount - 1));
                const minute = (c * 17 + 8) % 60;
                const saleTime = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`);

                let subtotal = 0;
                let total = 0;
                let discount = 0;

                const saleLines = chunk.map((item) => {
                    const prodInfo = productMap.get(item.productName);
                    const prodId = prodInfo ? prodInfo.id : Array.from(productMap.values())[0].id;
                    let qty = 0;
                    let amt = 0;
                    if (channel === 'CASH') { qty = item.cashQty; amt = item.cashAmount; }
                    else if (channel === 'EWALLET') { qty = item.ewalletQty; amt = item.ewalletAmount; }
                    else if (channel === 'GRAB') { qty = item.grabQty; amt = item.grabAmount; }
                    else if (channel === 'SENIOR') { qty = item.seniorQty; amt = item.seniorAmount; }

                    const lineTotal = amt > 0 ? amt : qty * item.price;
                    const lineSubtotal = lineTotal;
                    const lineDiscount = 0;

                    subtotal += lineSubtotal;
                    discount += lineDiscount;
                    total += lineTotal;

                    return {
                        productId: prodId,
                        qty,
                        unitPrice: qty > 0 ? Number((lineTotal / qty).toFixed(2)) : item.price,
                        discount: lineDiscount,
                        tax: 0,
                        total: lineTotal,
                        nameSnapshot: item.productName,
                    };
                });

                const sale = await prisma.sale.create({
                    data: {
                        storeId: store.id,
                        cashierId: cashierUser.id,
                        status: SaleStatus.FINALIZED,
                        receiptNumber: nextReceiptNumber++,
                        paymentMethod,
                        orderType,
                        subtotal: Number(subtotal.toFixed(2)),
                        discount: Number(discount.toFixed(2)),
                        tax: 0,
                        total: Number(total.toFixed(2)),
                        createdAt: saleTime,
                        finalizedAt: saleTime,
                        items: {
                            create: saleLines,
                        },
                    },
                });

                // Deduct sold products
                const prodMovements: Prisma.InventoryMovementCreateManyInput[] = saleLines.map((line) => ({
                    storeId: store.id,
                    itemType: ItemType.PRODUCT,
                    itemId: line.productId,
                    qtyDelta: -line.qty,
                    type: MovementType.SALE,
                    referenceType: 'Sale',
                    referenceId: sale.id,
                    createdById: cashierUser.id,
                    createdAt: saleTime,
                }));

                await prisma.inventoryMovement.createMany({ data: prodMovements });
            }
        }

        // Daily ingredient deduction for lemon & flavor consumption
        const dailyIngredientDeductions: Prisma.InventoryMovementCreateManyInput[] = [];
        if (day.inventory.lemon.used > 0 && ingredientMap.has('Fresh Lemon')) {
            dailyIngredientDeductions.push({
                storeId: store.id,
                itemType: ItemType.INGREDIENT,
                itemId: ingredientMap.get('Fresh Lemon')!,
                qtyDelta: -day.inventory.lemon.used,
                type: MovementType.SALE,
                note: `Lemon used for sales on ${dateStr}`,
                createdById: cashierUser.id,
                createdAt: new Date(`${dateStr}T21:00:00+08:00`),
            });
        }

        for (const f of day.inventory.flavors) {
            const mappedIng = flavorToIngredient[f.name.toUpperCase()] || f.name;
            if (f.used > 0 && ingredientMap.has(mappedIng)) {
                dailyIngredientDeductions.push({
                    storeId: store.id,
                    itemType: ItemType.INGREDIENT,
                    itemId: ingredientMap.get(mappedIng)!,
                    qtyDelta: -f.used,
                    type: MovementType.SALE,
                    note: `Flavor used for sales: ${mappedIng} on ${dateStr}`,
                    createdById: cashierUser.id,
                    createdAt: new Date(`${dateStr}T21:00:00+08:00`),
                });
            }
        }

        for (const s of day.inventory.supplies) {
            const mappedIng = supplyToIngredient[s.name] || s.name;
            if (s.used > 0 && ingredientMap.has(mappedIng)) {
                const isSugar = mappedIng === 'White Sugar' || mappedIng === 'Brown Sugar';
                const qty = isSugar ? s.used * 1000 : s.used;
                dailyIngredientDeductions.push({
                    storeId: store.id,
                    itemType: ItemType.INGREDIENT,
                    itemId: ingredientMap.get(mappedIng)!,
                    qtyDelta: -qty,
                    type: MovementType.SALE,
                    note: `Packaging/Supplies used on ${dateStr}: ${mappedIng}`,
                    createdById: cashierUser.id,
                    createdAt: new Date(`${dateStr}T21:00:00+08:00`),
                });
            }
        }

        if (dailyIngredientDeductions.length > 0) {
            await prisma.inventoryMovement.createMany({ data: dailyIngredientDeductions });
        }

        // Expenses
        const foodAllowance = day.summary['FOOD ALLOWANCE'] || 0;
        const storeExpenses = day.summary['EXPENSES'] || 0;

        if (foodAllowance > 0) {
            await prisma.expense.create({
                data: {
                    storeId: store.id,
                    date: dateObj,
                    amount: foodAllowance,
                    category: 'Food Allowance',
                    note: 'Staff food allowance',
                    source: ExpenseSource.DAILY_SALES,
                    createdById: ownerUser.id,
                    createdAt: new Date(`${dateStr}T13:00:00+08:00`),
                },
            });
        }

        if (storeExpenses > 0) {
            await prisma.expense.create({
                data: {
                    storeId: store.id,
                    date: dateObj,
                    amount: storeExpenses,
                    category: 'Store Expenses',
                    note: 'Daily store miscellaneous expense',
                    source: ExpenseSource.DAILY_SALES,
                    createdById: ownerUser.id,
                    createdAt: new Date(`${dateStr}T14:00:00+08:00`),
                },
            });
        }

        // DailySalesEntry
        const cashSalesAmt = day.summary['CASH SALES'] || 0;
        const ewalletSalesAmt = day.summary['EWALLET SALES'] || 0;
        const grabSalesAmt = day.summary['GRAB SALES'] || 0;
        const sheetTotalSales = day.summary['TOTAL SALES'] || 0;
        const totalExpenses = foodAllowance + storeExpenses;
        const balanceForDeposit = day.summary['BALANCE FOR DEPOSIT'] || (cashSalesAmt - totalExpenses);
        // Grab sales added to ewallet/gcash sales; reconcile with sheet TOTAL SALES when present
        const totalGcashSales = Number(
            (sheetTotalSales > 0 ? sheetTotalSales - balanceForDeposit - totalExpenses : ewalletSalesAmt + grabSalesAmt).toFixed(2)
        );

        const dse = await prisma.dailySalesEntry.create({
            data: {
                storeId: store.id,
                date: dateObj,
                expense: totalExpenses > 0 ? totalExpenses : null,
                seniorDiscount: 0,
                actualCoh: balanceForDeposit,
                createdById: cashierUser.id,
                createdAt: new Date(`${dateStr}T21:30:00+08:00`),
            },
        });

        // Physical cash remitted is balanceForDeposit (cash sales minus drawer expenses)
        const remittedCash = balanceForDeposit;
        const cashCoins = Number((remittedCash % 100).toFixed(2));
        const remittedBills = Math.floor(remittedCash);
        const cash1000 = Math.floor(remittedBills / 1000);
        const cash500 = Math.floor((remittedBills % 1000) / 500);
        const cash100 = Math.floor((remittedBills % 500) / 100);

        await prisma.dailySalesCashierEntry.create({
            data: {
                dailySalesEntryId: dse.id,
                userId: cashierUser.id,
                cashAmount: remittedCash,
                gcashAmount: totalGcashSales,
                denom1000: cash1000,
                denom500: cash500,
                denom100: cash100,
                coins: cashCoins,
            },
        });

        // DailyInventoryReport & Items
        const report = await prisma.dailyInventoryReport.create({
            data: {
                storeId: store.id,
                reportType: DailyInventoryReportType.CUSTOM,
                date: dateObj,
                createdById: cashierUser.id,
                createdAt: new Date(`${dateStr}T21:45:00+08:00`),
            },
        });

        const reportItems: Prisma.DailyInventoryReportItemCreateManyInput[] = [];
        let sortOrder = 1;

        // Lemon report item
        reportItems.push({
            reportId: report.id,
            section: 'Lemons',
            particulars: 'Fresh Lemon',
            unit: 'pc',
            openingInventory: day.inventory.lemon.start,
            delivery: day.inventory.lemon.in,
            endingInventory: day.inventory.lemon.end,
            itemType: ItemType.INGREDIENT,
            itemId: ingredientMap.get('Fresh Lemon') || null,
            sortOrder: sortOrder++,
        });

        // Flavors
        for (const f of day.inventory.flavors) {
            const mappedIng = flavorToIngredient[f.name.toUpperCase()] || f.name;
            reportItems.push({
                reportId: report.id,
                section: 'Flavors',
                particulars: f.name,
                unit: f.name.toUpperCase() === 'YAKULT' ? 'pc' : 'g',
                openingInventory: f.start,
                delivery: f.in,
                endingInventory: f.end,
                itemType: ItemType.INGREDIENT,
                itemId: ingredientMap.get(mappedIng) || null,
                sortOrder: sortOrder++,
            });
        }

        // Supplies
        for (const s of day.inventory.supplies) {
            const mappedIng = supplyToIngredient[s.name] || s.name;
            reportItems.push({
                reportId: report.id,
                section: 'Packaging & Supplies',
                particulars: s.name,
                unit: 'pc',
                openingInventory: s.start,
                delivery: s.in,
                endingInventory: s.end,
                itemType: ItemType.INGREDIENT,
                itemId: ingredientMap.get(mappedIng) || null,
                sortOrder: sortOrder++,
            });
        }

        await prisma.dailyInventoryReportItem.createMany({ data: reportItems });
    }

    console.log('✅ Lemon Co. October 2026 data generation complete!');
    console.log(`\nResults:`);
    console.log(` - Company / Store: "${store.name}" (${store.id})`);
    console.log(` - Ingredients: ${ingredientMap.size}`);
    console.log(` - Products & Recipes: ${productMap.size}`);
    console.log(` - Sales Generated: ${nextReceiptNumber - 10001} transactions across 31 days`);
    console.log(` - Owner login: owner@example.com (password: password123)`);
    console.log(` - Cashier login: cashier@example.com (password: password123)`);
};

if (require.main === module) {
    seedLemonCo()
        .catch((e) => {
            console.error('Seeding failed:', e);
            process.exit(1);
        })
        .finally(async () => {
            await defaultPrisma.$disconnect();
            process.exit(0);
        });
}
