import { NextFunction, Request, Response } from 'express';

type RateLimitOptions = {
    windowMs: number;
    max: number;
    message?: string;
    keyGenerator?: (req: Request) => string;
    skip?: (req: Request) => boolean;
    countOnlyOnFailure?: boolean;
};

type RateLimitEntry = {
    count: number;
    resetAt: number;
};

const getClientIp = (req: Request) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || 'unknown';
};

export const createRateLimiter = (options: RateLimitOptions) => {
    const store = new Map<string, RateLimitEntry>();

    const incrementCount = (key: string, now: number) => {
        const entry = store.get(key);
        if (!entry || now >= entry.resetAt) {
            store.set(key, { count: 1, resetAt: now + options.windowMs });
        } else {
            entry.count += 1;
            store.set(key, entry);
        }
    };

    return (req: Request, res: Response, next: NextFunction) => {
        if (options.skip && options.skip(req)) {
            return next();
        }

        const keyBase = options.keyGenerator ? options.keyGenerator(req) : getClientIp(req);
        const key = keyBase || 'unknown';
        const now = Date.now();

        // Check current count before potentially incrementing
        const currentEntry = store.get(key);
        const currentCount = currentEntry && now < currentEntry.resetAt ? currentEntry.count : 0;

        // If already at limit, reject immediately
        if (currentCount >= options.max) {
            const retryAfterSeconds = Math.ceil((currentEntry!.resetAt - now) / 1000);
            res.setHeader('Retry-After', retryAfterSeconds.toString());
            return res.status(429).json({
                error: {
                    code: 'RATE_LIMIT',
                    message: options.message ?? 'Too many requests. Please try again later.',
                },
            });
        }

        // If counting only on failure, intercept the response
        if (options.countOnlyOnFailure) {
            const originalJson = res.json.bind(res);
            res.json = (body: unknown) => {
                // Count as failure if status >= 400
                if (res.statusCode >= 400) {
                    incrementCount(key, Date.now());
                }
                return originalJson(body);
            };
            return next();
        }

        // Default behavior: count all requests
        incrementCount(key, now);
        return next();
    };
};
