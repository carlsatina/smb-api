import { Prisma } from '@prisma/client';

/**
 * Sales channels (e.g. Grab) are configured per store. A sale with no channel is
 * a walk-in sale at store prices. A channel price is the store price plus the
 * channel markup, rounded, unless the product has an explicit price for that
 * channel (Product.channelPrices).
 */
export const CHANNEL_ROUNDING = ['NONE', 'NEAREST_1', 'NEAREST_5', 'UP_5', 'NEAREST_10'] as const;
export type ChannelRounding = (typeof CHANNEL_ROUNDING)[number];

export type SalesChannel = {
    key: string;
    name: string;
    markupPercent: number;
    rounding: ChannelRounding;
    // Delivery-app orders are packed to go, so they deduct takeout packaging.
    alwaysTakeout: boolean;
    active: boolean;
};

const roundMoney = (value: number) => Number(value.toFixed(2));

export const applyRounding = (value: number, rounding: ChannelRounding) => {
    // Small epsilon so 112.5 rounds half-up despite float error.
    const eps = 1e-9;
    switch (rounding) {
        case 'NEAREST_1':
            return Math.round(value + eps);
        case 'NEAREST_5':
            return Math.round(value / 5 + eps) * 5;
        case 'UP_5':
            return Math.ceil(value / 5 - eps) * 5;
        case 'NEAREST_10':
            return Math.round(value / 10 + eps) * 10;
        default:
            return roundMoney(value);
    }
};

export const computeChannelPrice = (basePrice: number, channel: SalesChannel, override?: number | null) => {
    if (override !== null && override !== undefined && Number.isFinite(override) && override >= 0) {
        return roundMoney(override);
    }
    return applyRounding(basePrice * (1 + channel.markupPercent / 100), channel.rounding);
};

export const channelKeyFromName = (name: string) =>
    name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 30) || 'CHANNEL';

export const parseSalesChannels = (value: Prisma.JsonValue | null | undefined): SalesChannel[] => {
    if (!Array.isArray(value)) return [];
    const channels: SalesChannel[] = [];
    value.forEach((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
        const raw = entry as Record<string, unknown>;
        if (typeof raw.key !== 'string' || typeof raw.name !== 'string') return;
        const markup = Number(raw.markupPercent);
        channels.push({
            key: raw.key,
            name: raw.name,
            markupPercent: Number.isFinite(markup) ? markup : 0,
            rounding: (CHANNEL_ROUNDING as readonly string[]).includes(raw.rounding as string)
                ? (raw.rounding as ChannelRounding)
                : 'NONE',
            alwaysTakeout: raw.alwaysTakeout !== false,
            active: raw.active !== false,
        });
    });
    return channels;
};

/**
 * Normalises a submitted channel list. Keys are stable identifiers stored on
 * sales, so existing keys are kept and new channels get one from their name.
 */
export const normalizeSalesChannels = (
    input: Array<Omit<SalesChannel, 'key'> & { key?: string | null }>,
    existing: SalesChannel[]
): SalesChannel[] => {
    const used = new Set<string>();
    const existingKeys = new Set(existing.map((channel) => channel.key));
    return input.map((channel) => {
        let key = channel.key && existingKeys.has(channel.key) ? channel.key : channelKeyFromName(channel.name);
        const base = key;
        let suffix = 2;
        while (used.has(key)) key = `${base}_${suffix++}`;
        used.add(key);
        return {
            key,
            name: channel.name.trim(),
            markupPercent: roundMoney(channel.markupPercent),
            rounding: channel.rounding,
            alwaysTakeout: channel.alwaysTakeout,
            active: channel.active,
        };
    });
};

/** Product.channelPrices: { [channelKey]: price } — only explicit overrides. */
export const parseChannelPrices = (value: Prisma.JsonValue | null | undefined): Record<string, number> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Record<string, number> = {};
    Object.entries(value).forEach(([key, price]) => {
        const amount = Number(price);
        if (Number.isFinite(amount) && amount >= 0) result[key] = roundMoney(amount);
    });
    return result;
};
