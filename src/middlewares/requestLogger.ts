import { NextFunction, Request, Response } from 'express';
import { logger } from '../shared/logger';
import { recordRequest } from '../shared/metrics';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime();
    const requestId = res.locals.requestId as string | undefined;

    res.on('finish', () => {
        const diff = process.hrtime(start);
        const durationMs = diff[0] * 1000 + diff[1] / 1e6;
        const routePath = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.originalUrl;
        recordRequest({
            method: req.method,
            path: routePath,
            status: res.statusCode,
            durationMs,
        });
        const payload = {
            requestId,
            method: req.method,
            path: routePath,
            status: res.statusCode,
            durationMs,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
        };
        if (res.statusCode >= 500) {
            logger.error('request_completed', payload);
        } else if (res.statusCode >= 400) {
            logger.warn('request_completed', payload);
        } else {
            logger.info('request_completed', payload);
        }
    });

    next();
};
