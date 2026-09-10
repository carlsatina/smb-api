export interface TemplateItem {
    particulars: string;
    unit: string;
    section: string;
    reminders?: string;
    sortOrder: number;
}

export const TAKOYAKI_TEMPLATE: TemplateItem[] = [
    // Main Ingredients
    { particulars: 'Best Takoyaki Flour', unit: 'kilo/pack', section: 'Main', sortOrder: 1 },
    { particulars: 'Best Jap Mayo', unit: 'kilo', section: 'Main', sortOrder: 2 },
    { particulars: 'Take out Box', unit: 'pcs', section: 'Main', sortOrder: 3 },
    { particulars: 'Octobits', unit: 'kilo', section: 'Main', sortOrder: 4 },
    { particulars: 'Crab Stick', unit: 'grams', section: 'Main', reminders: 'Expiry: 12.7.26', sortOrder: 5 },
    { particulars: 'Bonito Flakes', unit: 'grams', section: 'Main', sortOrder: 6 },
    { particulars: 'Aoinori', unit: 'grams', section: 'Main', reminders: 'Expiry: Oct 2026', sortOrder: 7 },
    { particulars: 'Cheese Sauce', unit: 'grams', section: 'Main', sortOrder: 8 },
    { particulars: 'Best Takoyaki Sauce', unit: 'gal', section: 'Main', sortOrder: 9 },

    // Others
    { particulars: 'Eggs', unit: 'pcs', section: 'Others', reminders: 'Use 2 eggs per mixture only', sortOrder: 10 },
    { particulars: 'Cabbage', unit: 'Grams', section: 'Others', sortOrder: 11 },
    { particulars: 'Spring Onions', unit: 'Grams', section: 'Others', sortOrder: 12 },
    { particulars: 'Cheese Bar', unit: 'Grams', section: 'Others', sortOrder: 13 },
    { particulars: 'Hot Sauce', unit: 'gal', section: 'Others', sortOrder: 14 },
    { particulars: 'Water', unit: 'gal', section: 'Others', sortOrder: 15 },
    { particulars: 'Oil', unit: 'gal', section: 'Others', sortOrder: 16 },
    { particulars: 'Corn', unit: 'can', section: 'Others', reminders: 'Opened: 4/28', sortOrder: 17 },
    { particulars: 'Bacon', unit: 'Grams', section: 'Others', reminders: 'REMINDERS: Defrost Bacon Delivery: 9/2026', sortOrder: 18 },
    { particulars: 'Takoyaki stick', unit: 'Pcs', section: 'Others', sortOrder: 19 },
    { particulars: 'Chilli Powder', unit: 'grams', section: 'Others', sortOrder: 20 },

    // Supplies & Packaging & Cleaning
    { particulars: 'Takeout Plastic', unit: 'pcs', section: 'Supplies', sortOrder: 21 },
    { particulars: 'Tplastic for cup', unit: 'pcs', section: 'Supplies', sortOrder: 22 },
    { particulars: 'Paper bag', unit: 'pcs', section: 'Supplies', sortOrder: 23 },
    { particulars: 'Garbage plastic', unit: 'roll', section: 'Supplies', sortOrder: 24 },
    { particulars: 'Gloves', unit: 'pcs', section: 'Supplies', sortOrder: 25 },
    { particulars: 'Tissue', unit: 'pcs', section: 'Supplies', sortOrder: 26 },
    { particulars: 'Rag', unit: 'pcs', section: 'Supplies', sortOrder: 27 },
    { particulars: 'Dishwashing Liquid', unit: 'Grams', section: 'Supplies', sortOrder: 28 },
    { particulars: 'Sponge', unit: 'pcs', section: 'Supplies', sortOrder: 29 },
    { particulars: 'Alchohol', unit: 'grams', section: 'Supplies', sortOrder: 30 },
    { particulars: 'Chlorine', unit: 'grams', section: 'Supplies', sortOrder: 31 },
];

export const BUKO_TEMPLATE: TemplateItem[] = [
    // Main Ingredients
    { particulars: 'Concentrates', unit: 'gallon', section: 'Main', sortOrder: 1 },
    { particulars: 'Buko Juice', unit: 'bot', section: 'Main', reminders: 'Always check daily', sortOrder: 2 },
    { particulars: 'Buko Meat', unit: 'grams', section: 'Main', reminders: 'Always check daily', sortOrder: 3 },
    { particulars: 'Mango syrup', unit: 'grams', section: 'Main', sortOrder: 4 },

    // PLASTIC CUPS
    { particulars: '12 oz', unit: 'pcs', section: 'PLASTIC CUPS', sortOrder: 5 },
    { particulars: '16 oz', unit: 'pcs', section: 'PLASTIC CUPS', sortOrder: 6 },
    { particulars: '22 oz', unit: 'pcs', section: 'PLASTIC CUPS', sortOrder: 7 },
    { particulars: 'cover', unit: 'pcs', section: 'PLASTIC CUPS', sortOrder: 8 },

    // FLAT LID
    { particulars: 'Straw', unit: 'kilo/pck', section: 'FLAT LID', sortOrder: 9 },

    // BOTTLES
    { particulars: 'Small', unit: 'pcs', section: 'BOTTLES', sortOrder: 10 },
    { particulars: 'Medium', unit: 'pcs', section: 'BOTTLES', sortOrder: 11 },
    { particulars: 'Large', unit: 'pcs', section: 'BOTTLES', sortOrder: 12 },
    { particulars: 'Milk', unit: 'liter', section: 'BOTTLES', sortOrder: 13 },
];

export const getTemplateItems = (reportType: 'TAKOYAKI' | 'BUKO' | 'CUSTOM'): TemplateItem[] => {
    switch (reportType) {
        case 'TAKOYAKI':
            return TAKOYAKI_TEMPLATE;
        case 'BUKO':
            return BUKO_TEMPLATE;
        default:
            return [];
    }
};
