import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../shared/errors';

export type AuthUser = {
    sub: string;
    email: string;
    isSuperAdmin: boolean;
    aud?: 'app' | 'admin';
};

export type AuthRequest = Request & {
    user?: AuthUser;
};

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header) {
        return next(new AppError('UNAUTHORIZED', 'Missing Authorization header', 401));
    }

    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (!token) {
        return next(new AppError('UNAUTHORIZED', 'Missing access token', 401));
    }

    try {
        const payload = jwt.verify(token, env.accessTokenSecret) as AuthUser;
        req.user = payload;
        return next();
    } catch (error) {
        return next(new AppError('UNAUTHORIZED', 'Invalid access token', 401));
    }
};
