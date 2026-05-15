import * as Sentry from '@sentry/node';
import { env } from '../config/env';
import { logger } from './logger';

type ErrorContext = {
    requestId?: string;
    method?: string;
    path?: string;
    userId?: string | null;
    storeId?: string | null;
};

let initialized = false;

const normalizeError = (error: unknown) => {
    if (error instanceof Error) {
        return error;
    }
    return new Error(typeof error === 'string' ? error : 'Unknown error');
};

export const initErrorReporting = () => {
    if (initialized) {
        return;
    }
    const dsn = env.errorReportingDsn;
    if (!dsn) {
        return;
    }

    Sentry.init({
        dsn,
        environment: env.nodeEnv,
        release: env.release,
        tracesSampleRate: Number.isFinite(env.errorReportingTracesSampleRate)
            ? env.errorReportingTracesSampleRate
            : 0,
    });

    process.on('unhandledRejection', (reason) => {
        const error = normalizeError(reason);
        logger.error('unhandled_rejection', { message: error.message });
        Sentry.captureException(error);
    });

    process.on('uncaughtException', (error) => {
        logger.error('uncaught_exception', { message: error.message });
        Sentry.captureException(error);
    });

    initialized = true;
};

export const captureException = (error: unknown, context?: ErrorContext) => {
    if (!initialized) {
        return;
    }
    const normalized = normalizeError(error);
    Sentry.withScope((scope) => {
        if (context?.requestId) {
            scope.setTag('request_id', context.requestId);
        }
        if (context?.method) {
            scope.setTag('http.method', context.method);
        }
        if (context?.path) {
            scope.setTag('http.path', context.path);
        }
        if (context?.userId) {
            scope.setUser({ id: context.userId });
        }
        if (context?.storeId) {
            scope.setTag('store_id', context.storeId);
        }
        Sentry.captureException(normalized);
    });
};

export const captureHealthCheck = (status: 'ok' | 'error', durationMs: number) => {
    if (!initialized) {
        return;
    }
    const slug = env.errorReportingHealthcheckSlug;
    if (!slug) {
        return;
    }
    const durationSeconds = Math.max(0, durationMs / 1000);
    const monitorConfig = env.errorReportingHealthcheckSchedule
        ? {
              schedule: { type: 'crontab' as const, value: env.errorReportingHealthcheckSchedule },
              checkinMargin: env.errorReportingHealthcheckCheckinMargin,
              maxRuntime: env.errorReportingHealthcheckMaxRuntime,
              timezone: env.errorReportingHealthcheckTimezone,
          }
        : undefined;

    Sentry.captureCheckIn(
        {
            monitorSlug: slug,
            status,
            duration: durationSeconds,
        },
        monitorConfig
    );
};
