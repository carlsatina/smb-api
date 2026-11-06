import { Role } from '@prisma/client';
import { z } from 'zod';
import { PERMISSION_KEYS } from '../../shared/permissions';

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

export const setMemberSuspensionSchema = z.object({
    suspended: z.boolean(),
});

export const acceptInviteSchema = z.object({
    token: z.string().min(10),
});

// Full list of permissions the member should have; stored as exceptions vs their role.
export const updateMemberPermissionsSchema = z.object({
    permissions: z.array(
        z.string().refine((value) => (PERMISSION_KEYS as string[]).includes(value), { message: 'Unknown permission.' })
    ),
});
