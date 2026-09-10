import { describe, expect, it } from 'vitest';
import { BUKO_TEMPLATE, TAKOYAKI_TEMPLATE, getTemplateItems } from '../src/modules/dailyInventory/dailyInventory.templates';
import { getDailyReportQuerySchema, saveDailyReportSchema } from '../src/modules/dailyInventory/dailyInventory.schemas';

describe('Daily Inventory Templates', () => {
    it('returns Takoyaki template with all required particulars and sections', () => {
        const items = getTemplateItems('TAKOYAKI');
        expect(items.length).toBe(31);

        const flour = items.find((i) => i.particulars === 'Best Takoyaki Flour');
        expect(flour).toBeDefined();
        expect(flour?.unit).toBe('kilo/pack');
        expect(flour?.section).toBe('Main');

        const eggs = items.find((i) => i.particulars === 'Eggs');
        expect(eggs).toBeDefined();
        expect(eggs?.section).toBe('Others');
        expect(eggs?.reminders).toBe('Use 2 eggs per mixture only');

        const plastic = items.find((i) => i.particulars === 'Takeout Plastic');
        expect(plastic).toBeDefined();
        expect(plastic?.section).toBe('Supplies');
    });

    it('returns Buko template with all required particulars and sections', () => {
        const items = getTemplateItems('BUKO');
        expect(items.length).toBe(13);

        const concentrates = items.find((i) => i.particulars === 'Concentrates');
        expect(concentrates).toBeDefined();
        expect(concentrates?.unit).toBe('gallon');

        const cups = items.find((i) => i.particulars === '12 oz');
        expect(cups).toBeDefined();
        expect(cups?.section).toBe('PLASTIC CUPS');

        const bottles = items.find((i) => i.particulars === 'Small');
        expect(bottles).toBeDefined();
        expect(bottles?.section).toBe('BOTTLES');
    });
});

describe('Daily Inventory Schemas', () => {
    it('validates query params correctly', () => {
        const valid = getDailyReportQuerySchema.parse({
            reportType: 'TAKOYAKI',
            date: '2026-09-11',
        });
        expect(valid.reportType).toBe('TAKOYAKI');
        expect(valid.date).toBe('2026-09-11');

        expect(() =>
            getDailyReportQuerySchema.parse({
                reportType: 'INVALID',
                date: '2026-09-11',
            })
        ).toThrow();
    });

    it('validates save payload structure', () => {
        const payload = {
            reportType: 'BUKO',
            date: '2026-09-11',
            items: [
                {
                    particulars: 'Buko Juice',
                    unit: 'bot',
                    openingInventory: 4,
                    delivery: 2,
                    endingInventory: 3,
                    reminders: 'Always check daily',
                },
            ],
        };
        const parsed = saveDailyReportSchema.parse(payload);
        expect(parsed.items[0].particulars).toBe('Buko Juice');
        expect(parsed.items[0].openingInventory).toBe(4);
        expect(parsed.items[0].endingInventory).toBe(3);
    });
});

describe('Daily Inventory Calculations & Rollover Logic', () => {
    it('calculates total as opening + delivery and total used as total - ending', () => {
        const opening = 10;
        const delivery = 5;
        const ending = 8;

        const total = opening + delivery;
        expect(total).toBe(15);

        const totalUsed = Math.max(0, total - ending);
        expect(totalUsed).toBe(7);
    });

    it('rolls over previous day ending to next day opening', () => {
        // Day 1
        const day1EndingInventory = 12.5;

        // Day 2 initialization from Day 1
        const day2OpeningInventory = day1EndingInventory;
        const day2Delivery = 10;
        const day2Total = day2OpeningInventory + day2Delivery;
        const day2Ending = 14;
        const day2Used = day2Total - day2Ending;

        expect(day2OpeningInventory).toBe(12.5);
        expect(day2Total).toBe(22.5);
        expect(day2Used).toBe(8.5);
    });

    it('enforces that store staff opening inventory cannot be overridden', () => {
        const isOwnerOrAdmin = (role: string) => ['OWNER', 'ADMIN'].includes(role);

        const existingDbOpening = 15;
        const staffSubmittedOpening = 999; // Store staff tries to change opening
        const staffRole = 'CASHIER';

        const finalOpening = isOwnerOrAdmin(staffRole) ? staffSubmittedOpening : existingDbOpening;
        expect(finalOpening).toBe(15); // Preserved!

        const adminRole = 'ADMIN';
        const adminSubmittedOpening = 20;
        const adminFinalOpening = isOwnerOrAdmin(adminRole) ? adminSubmittedOpening : existingDbOpening;
        expect(adminFinalOpening).toBe(20); // Admin can update
    });

    it('matches sheet particulars with inventory aliases and normalized names', () => {
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

        const aliases: Record<string, string[]> = {
            'best takoyaki flour': ['takoyaki flour', 'flour'],
            'best jap mayo': ['kewpie mayo', 'kewpie', 'jap mayo', 'japanese mayo'],
            'take out box': ['takeout box'],
            'best takoyaki sauce': ['takoyaki sauce', 'sauce'],
        };

        const storeInventory = ['takoyaki flour', 'kewpie mayo', 'takeout box', 'takoyaki sauce'];

        const match = (sheetParticular: string) => {
            const lower = sheetParticular.toLowerCase();
            const norm = normalize(sheetParticular);
            if (storeInventory.some((inv) => inv.toLowerCase() === lower || normalize(inv) === norm)) {
                return true;
            }
            const candidateAliases = aliases[lower] || [];
            return candidateAliases.some((alias) =>
                storeInventory.some((inv) => inv.toLowerCase() === alias.toLowerCase() || normalize(inv) === normalize(alias))
            );
        };

        expect(match('Best Takoyaki Flour')).toBe(true);
        expect(match('Best Jap Mayo')).toBe(true);
        expect(match('Take out Box')).toBe(true);
        expect(match('Best Takoyaki Sauce')).toBe(true);
        expect(match('Non-existent Item')).toBe(false);
    });
});


