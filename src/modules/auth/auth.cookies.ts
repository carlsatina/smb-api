import crypto from 'crypto';
import { Request, Response } from 'express';
import { env } from '../../config/env';

const parseDurationToMs = (value: string) => {
    const match = value.match(/^(\d+)([smhd])$/);
    if (!match) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric * 1000;
        }
        return 7 * 24 * 60 * 60 * 1000;
    }
    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier =
        unit === 's'
            ? 1000
            : unit === 'm'
              ? 60 * 1000
              : unit === 'h'
                ? 60 * 60 * 1000
                : 24 * 60 * 60 * 1000;
    return amount * multiplier;
};

const parseCookies = (header: string | undefined) => {
    if (!header) {
        return {};
    }
    return header.split(';').reduce<Record<string, string>>((acc, part) => {
        const [rawKey, ...rawValue] = part.trim().split('=');
        if (!rawKey) {
            return acc;
        }
        const key = decodeURIComponent(rawKey);
        const value = decodeURIComponent(rawValue.join('='));
        acc[key] = value;
        return acc;
    }, {});
};

const normalizeSameSite = (value: string): 'lax' | 'strict' | 'none' => {
    const normalized = value.toLowerCase();
    if (normalized === 'strict') return 'strict';
    if (normalized === 'none') return 'none';
    return 'lax';
};

const buildRefreshCookieOptions = () => {
    const sameSite = normalizeSameSite(env.refreshTokenCookieSameSite);
    const secure = env.refreshTokenCookieSecure || sameSite === 'none';
    return {
        httpOnly: true,
        secure,
        sameSite,
        path: env.refreshTokenCookiePath,
        domain: env.refreshTokenCookieDomain || undefined,
        maxAge: parseDurationToMs(env.refreshTokenExpiresIn),
    } as const;
};

const buildCsrfCookieOptions = () => {
    const sameSite = normalizeSameSite(env.csrfCookieSameSite);
    const secure = env.csrfCookieSecure || sameSite === 'none';
    return {
        httpOnly: false,
        secure,
        sameSite,
        path: env.csrfCookiePath,
        domain: env.csrfCookieDomain || undefined,
        maxAge: parseDurationToMs(env.refreshTokenExpiresIn),
    } as const;
};

// Admin sessions use separate cookie names so an admin session and a normal
// session can coexist in the same browser without clobbering each other.
const adminRefreshCookieName = `${env.refreshTokenCookieName}.admin`;
const adminCsrfCookieName = `${env.csrfCookieName}.admin`;

export const getRefreshTokenFromRequest = (req: Request) => {
    const cookies = parseCookies(req.headers.cookie);
    return cookies[env.refreshTokenCookieName] ?? null;
};

export const getCsrfTokenFromRequest = (req: Request) => {
    const cookies = parseCookies(req.headers.cookie);
    return cookies[env.csrfCookieName] ?? null;
};

export const getAdminRefreshTokenFromRequest = (req: Request) => {
    const cookies = parseCookies(req.headers.cookie);
    return cookies[adminRefreshCookieName] ?? null;
};

export const getAdminCsrfTokenFromRequest = (req: Request) => {
    const cookies = parseCookies(req.headers.cookie);
    return cookies[adminCsrfCookieName] ?? null;
};

export const generateCsrfToken = () => {
    return crypto.randomBytes(24).toString('hex');
};

export const setRefreshTokenCookie = (res: Response, token: string) => {
    const options = buildRefreshCookieOptions();
    res.cookie(env.refreshTokenCookieName, token, options);
};

export const setCsrfTokenCookie = (res: Response, token: string) => {
    const options = buildCsrfCookieOptions();
    res.cookie(env.csrfCookieName, token, options);
};

export const clearRefreshTokenCookie = (res: Response) => {
    const { maxAge, ...options } = buildRefreshCookieOptions();
    res.clearCookie(env.refreshTokenCookieName, options);
};

export const clearCsrfTokenCookie = (res: Response) => {
    const { maxAge, ...options } = buildCsrfCookieOptions();
    res.clearCookie(env.csrfCookieName, options);
};

export const setAdminRefreshTokenCookie = (res: Response, token: string) => {
    const options = buildRefreshCookieOptions();
    res.cookie(adminRefreshCookieName, token, options);
};

export const setAdminCsrfTokenCookie = (res: Response, token: string) => {
    const options = buildCsrfCookieOptions();
    res.cookie(adminCsrfCookieName, token, options);
};

export const clearAdminRefreshTokenCookie = (res: Response) => {
    const { maxAge, ...options } = buildRefreshCookieOptions();
    res.clearCookie(adminRefreshCookieName, options);
};

export const clearAdminCsrfTokenCookie = (res: Response) => {
    const { maxAge, ...options } = buildCsrfCookieOptions();
    res.clearCookie(adminCsrfCookieName, options);
};
