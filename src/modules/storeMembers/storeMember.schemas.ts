import { Role } from '@prisma/client';
import { z } from 'zod';

const optionalNumber = z.preprocess(
    (value) => {
        if (value === null || value === undefined || value === '') {
            return undefined;
        }
        if (typeof value === 'string') {
            return Number(value);
        }
        return value;
    },
    z.number().int().min(1).max(30)
).optional();

export const createInviteSchema = z.object({
    email: z.string().email(),
    role: z.nativeEnum(Role),
    expiresInDays: optionalNumber,
});

export const updateMemberRoleSchema = z.object({
    role: z.nativeEnum(Role),
});

export const acceptInviteSchema = z.object({
    token: z.string().min(10),
});
