import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';

export const requestId = (req: Request, res: Response, next: NextFunction) => {
    const headerId = req.headers['x-request-id'];
    const incoming = typeof headerId === 'string' && headerId.trim().length > 0 ? headerId.trim() : null;
    const id = incoming ?? crypto.randomUUID();
    res.locals.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
};
