type LogLevel = 'info' | 'warn' | 'error';

type LogMeta = Record<string, unknown>;

// Severity ordering used to filter logs below the configured threshold.
const LEVEL_PRIORITY: Record<LogLevel, number> = { info: 10, warn: 20, error: 30 };

// LOG_LEVEL controls verbosity (default 'info' keeps existing behavior):
//   info   → everything (includes per-request success logs)
//   warn   → warnings + errors only (hides request_completed 2xx noise)
//   error  → errors only
//   silent → nothing
const resolveThreshold = (): number => {
    const configured = process.env.LOG_LEVEL?.toLowerCase();
    if (configured === 'silent' || configured === 'none' || configured === 'off') {
        return Number.POSITIVE_INFINITY;
    }
    if (configured && configured in LEVEL_PRIORITY) {
        return LEVEL_PRIORITY[configured as LogLevel];
    }
    return LEVEL_PRIORITY.info;
};

const threshold = resolveThreshold();

const writeLog = (level: LogLevel, message: string, meta: LogMeta = {}) => {
    if (LEVEL_PRIORITY[level] < threshold) {
        return;
    }
    const payload = {
        level,
        message,
        timestamp: new Date().toISOString(),
        ...meta,
    };
    const line = JSON.stringify(payload);
    if (level === 'error') {
        console.error(line);
    } else if (level === 'warn') {
        console.warn(line);
    } else {
        console.log(line);
    }
};

export const logger = {
    info: (message: string, meta?: LogMeta) => writeLog('info', message, meta),
    warn: (message: string, meta?: LogMeta) => writeLog('warn', message, meta),
    error: (message: string, meta?: LogMeta) => writeLog('error', message, meta),
};
