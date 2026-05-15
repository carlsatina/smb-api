type LogLevel = 'info' | 'warn' | 'error';

type LogMeta = Record<string, unknown>;

const writeLog = (level: LogLevel, message: string, meta: LogMeta = {}) => {
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
