import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import prisma from '../lib/prisma';
import { authService } from '../src/modules/auth/auth.service';

vi.mock('../lib/prisma', () => ({
    default: {
        user: {
            findUnique: vi.fn(),
        },
        refreshToken: {
            create: vi.fn(),
        },
    },
}));

vi.mock('bcrypt', () => ({
    default: {
        compare: vi.fn(),
        hash: vi.fn(),
    },
}));

vi.mock('jsonwebtoken', () => ({
    default: {
        sign: vi.fn(),
        verify: vi.fn(),
    },
}));

describe('authService.login', () => {
    it('returns tokens on valid credentials', async () => {
        const prismaMock = vi.mocked(prisma, { deep: true });
        const bcryptMock = vi.mocked(bcrypt, { deep: true });
        const jwtMock = vi.mocked(jwt, { deep: true });

        prismaMock.user.findUnique.mockResolvedValue({
            id: 'user-1',
            email: 'owner@example.com',
            passwordHash: 'hashed',
            fullName: 'Owner',
            emailVerifiedAt: null,
            subscriptionActive: true,
            payPerReceipt: false,
            planTier: 'STANDARD',
            grantedPlan: null,
            grantedUntil: null,
            isSuperAdmin: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        (bcryptMock.compare as unknown as { mockResolvedValue: (value: boolean) => void }).mockResolvedValue(true);
        (jwtMock.sign as unknown as { mockReturnValue: (value: string) => void }).mockReturnValue('token');

        const result = await authService.login('owner@example.com', 'password123');

        expect(result.accessToken).toBe('token');
        expect(result.refreshToken).toBe('token');
        expect(result.user.email).toBe('owner@example.com');
        expect(prismaMock.refreshToken.create).toHaveBeenCalled();
    });
});
