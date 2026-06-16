import dotenv from 'dotenv';

dotenv.config();

const getEnv = (key: string, fallback?: string) => {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
        return value;
    }
    return fallback;
};

const parseCsv = (value?: string) => {
    if (!value) return [];
    return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
};

const normalizeOrigin = (value: string) => {
    try {
        return new URL(value).origin;
    } catch (error) {
        return value;
    }
};

const normalizeSameSite = (value: string) => {
    const normalized = value.toLowerCase();
    if (normalized === 'strict') return 'strict';
    if (normalized === 'none') return 'none';
    return 'lax';
};

const appBaseUrl = getEnv('APP_BASE_URL', 'http://localhost:5173') as string;

export const env = {
    nodeEnv: getEnv('NODE_ENV', 'development') as 'development' | 'production' | 'test',
    port: Number(getEnv('PORT', '3500')),
    accessTokenSecret: getEnv('ACCESS_TOKEN_SECRET', 'dev_access_secret') as string,
    refreshTokenSecret: getEnv('REFRESH_TOKEN_SECRET', 'dev_refresh_secret') as string,
    aiEncryptionKey: getEnv('AI_ENCRYPTION_KEY'),
    accessTokenExpiresIn: getEnv('ACCESS_TOKEN_EXPIRES_IN', '15m') as string,
    refreshTokenExpiresIn: getEnv('REFRESH_TOKEN_EXPIRES_IN', '7d') as string,
    passwordResetExpiresIn: getEnv('PASSWORD_RESET_EXPIRES_IN', '1h') as string,
    emailVerificationExpiresIn: getEnv('EMAIL_VERIFICATION_EXPIRES_IN', '24h') as string,
    appBaseUrl,
    corsOrigins: (() => {
        const origins = parseCsv(getEnv('CORS_ORIGINS'));
        if (origins.length > 0) {
            return origins.map(normalizeOrigin);
        }
        return [normalizeOrigin(appBaseUrl)];
    })(),
    resendApiKey: getEnv('RESEND_API_KEY'),
    resendFrom: getEnv('RESEND_FROM'),
    smtpHost: getEnv('SMTP_HOST'),
    smtpPort: Number(getEnv('SMTP_PORT', '587')),
    smtpUser: getEnv('SMTP_USER'),
    smtpPass: getEnv('SMTP_PASS'),
    smtpFrom: getEnv('SMTP_FROM'),
    smtpSecure: getEnv('SMTP_SECURE', 'false') === 'true',
    refreshTokenCookieName: getEnv('REFRESH_TOKEN_COOKIE_NAME', 'refreshToken') as string,
    refreshTokenCookieSameSite: normalizeSameSite(getEnv('REFRESH_TOKEN_COOKIE_SAMESITE', 'lax') as string) as
        | 'lax'
        | 'strict'
        | 'none',
    refreshTokenCookieSecure: getEnv('REFRESH_TOKEN_COOKIE_SECURE', 'false') === 'true',
    refreshTokenCookieDomain: getEnv('REFRESH_TOKEN_COOKIE_DOMAIN'),
    refreshTokenCookiePath: getEnv('REFRESH_TOKEN_COOKIE_PATH', '/api/v1/auth') as string,
    csrfCookieName: getEnv('CSRF_COOKIE_NAME', 'csrfToken') as string,
    csrfCookieSameSite: normalizeSameSite(getEnv('CSRF_COOKIE_SAMESITE', 'lax') as string) as
        | 'lax'
        | 'strict'
        | 'none',
    csrfCookieSecure: getEnv('CSRF_COOKIE_SECURE', 'false') === 'true',
    csrfCookieDomain: getEnv('CSRF_COOKIE_DOMAIN'),
    csrfCookiePath: getEnv('CSRF_COOKIE_PATH', '/') as string,
    errorReportingDsn: getEnv('SENTRY_DSN') ?? getEnv('GLITCHTIP_DSN'),
    errorReportingTracesSampleRate: Number(getEnv('ERROR_REPORTING_TRACES_SAMPLE_RATE', '0')),
    release: getEnv('APP_RELEASE'),
    errorReportingHealthcheckSlug: getEnv('ERROR_REPORTING_HEALTHCHECK_SLUG'),
    errorReportingHealthcheckSchedule: getEnv('ERROR_REPORTING_HEALTHCHECK_SCHEDULE'),
    errorReportingHealthcheckCheckinMargin: Number(getEnv('ERROR_REPORTING_HEALTHCHECK_MARGIN', '5')),
    errorReportingHealthcheckMaxRuntime: Number(getEnv('ERROR_REPORTING_HEALTHCHECK_MAX_RUNTIME', '60')),
    errorReportingHealthcheckTimezone: getEnv('ERROR_REPORTING_HEALTHCHECK_TIMEZONE', 'UTC') as string,
};

const validateEnv = () => {
    if (env.nodeEnv !== 'production') {
        return;
    }

    const raw = (key: string) => process.env[key]?.trim();
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!raw('DATABASE_URL')) {
        errors.push('DATABASE_URL is required.');
    }
    const accessSecret = raw('ACCESS_TOKEN_SECRET');
    if (!accessSecret || accessSecret === 'dev_access_secret') {
        errors.push('ACCESS_TOKEN_SECRET must be set for production.');
    }
    const refreshSecret = raw('REFRESH_TOKEN_SECRET');
    if (!refreshSecret || refreshSecret === 'dev_refresh_secret') {
        errors.push('REFRESH_TOKEN_SECRET must be set for production.');
    }
    if (!raw('APP_BASE_URL')) {
        errors.push('APP_BASE_URL must be set for production.');
    }
    if (raw('REFRESH_TOKEN_COOKIE_SECURE') !== 'true') {
        errors.push('REFRESH_TOKEN_COOKIE_SECURE must be true in production.');
    }
    if (raw('CSRF_COOKIE_SECURE') !== 'true') {
        errors.push('CSRF_COOKIE_SECURE must be true in production.');
    }

    const refreshSameSite = raw('REFRESH_TOKEN_COOKIE_SAMESITE');
    if (refreshSameSite === 'none' && raw('REFRESH_TOKEN_COOKIE_SECURE') !== 'true') {
        errors.push('REFRESH_TOKEN_COOKIE_SECURE must be true when SameSite=None.');
    }
    const csrfSameSite = raw('CSRF_COOKIE_SAMESITE');
    if (csrfSameSite === 'none' && raw('CSRF_COOKIE_SECURE') !== 'true') {
        errors.push('CSRF_COOKIE_SECURE must be true when SameSite=None.');
    }

    const appBaseUrl = raw('APP_BASE_URL');
    if (appBaseUrl && !appBaseUrl.startsWith('https://')) {
        warnings.push('APP_BASE_URL should use https in production.');
    }

    if (warnings.length) {
        console.warn('[env] warnings:', warnings.join(' '));
    }

    if (errors.length) {
        throw new Error(`[env] configuration errors: ${errors.join(' ')}`);
    }
};

validateEnv();
