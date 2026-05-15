import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors';
import { logger } from '../shared/logger';
import { captureException } from '../shared/errorReporting';
import { AuthRequest } from './auth';

export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    const authReq = req as AuthRequest;
    const userId = authReq.user?.sub ?? null;
    const storeId = typeof req.params?.storeId === 'string' ? req.params.storeId : null;

    if (err instanceof AppError) {
        const statusCode = err.statusCode;
        if (statusCode >= 500) {
            captureException(err, {
                requestId,
                method: req.method,
                path: req.originalUrl,
                userId,
                storeId,
            });
            logger.error('request_failed', {
                requestId,
                method: req.method,
                path: req.originalUrl,
                status: statusCode,
                code: err.code,
                message: err.message,
            });
        } else {
            logger.warn('request_failed', {
                requestId,
                method: req.method,
                path: req.originalUrl,
                status: statusCode,
                code: err.code,
                message: err.message,
            });
        }
        return res.status(err.statusCode).json({
            error: {
                code: err.code,
                message: err.message,
                details: err.details,
            },
            requestId,
        });
    }

    if (err instanceof ZodError) {
        logger.warn('validation_failed', {
            requestId,
            method: req.method,
            path: req.originalUrl,
            status: 400,
        });
        return res.status(400).json({
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid request',
                details: err.flatten(),
            },
            requestId,
        });
    }

    captureException(err, {
        requestId,
        method: req.method,
        path: req.originalUrl,
        userId,
        storeId,
    });
    logger.error('unhandled_error', {
        requestId,
        method: req.method,
        path: req.originalUrl,
        status: 500,
        message: err.message,
        stack: err.stack,
    });
    return res.status(500).json({
        error: {
            code: 'INTERNAL_ERROR',
            message: 'Unexpected error',
        },
        requestId,
    });
};
