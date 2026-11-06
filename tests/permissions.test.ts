import { Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../lib/prisma';
import { requirePermission, requireStoreMember } from '../src/middlewares/requirePermission';
import {
    DEFAULT_ROLE_PERMISSIONS,
    effectivePermissions,
    memberOverridesFromGranted,
    overridesFromMatrix,
    parseRolePermissionOverrides,
    PERMISSION_KEYS,
    PermissionKey,
    permissionMatrix,
} from '../src/shared/permissions';
import { storeMemberService } from '../src/modules/storeMembers/storeMember.service';

vi.mock('../lib/prisma', () => {
    const storeMember = { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() };
    const auditLog = { create: vi.fn() };
    return {
        default: {
            storeMember,
            auditLog,
            store: { findFirst: vi.fn() },
            $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({ storeMember, auditLog })),
        },
    };
});

const prismaMock = vi.mocked(prisma, { deep: true });

const { OWNER, ADMIN, INVENTORY_MANAGER: IM, CASHIER, VIEWER } = Role;
const ALL_ROLES = [OWNER, ADMIN, IM, CASHIER, VIEWER];

const allowed = (anyOf: PermissionKey[]) =>
    ALL_ROLES.filter((role) => anyOf.some((key) => effectivePermissions(role, {}).includes(key))).sort();

describe('default permissions reproduce the previous role rules', () => {
    // [route guard, roles the route allowed before the permission system]
    const cases: Array<[string, PermissionKey[], Role[]]> = [
        ['products/inventory reads (incl. POS catalog)', ['inventory.view', 'pos.use'], ALL_ROLES],
        ['ingredients, recipes, suppliers, purchase orders reads', ['inventory.view'], [OWNER, ADMIN, IM, VIEWER]],
        ['catalog & stock writes', ['inventory.manage'], [OWNER, ADMIN, IM]],
        ['finalize sale', ['pos.use'], [OWNER, ADMIN, CASHIER]],
        ['void sales', ['sales.void'], [OWNER, ADMIN]],
        ['edit / import sales', ['sales.edit'], [OWNER, ADMIN]],
        ['reports', ['reports.view'], [OWNER, ADMIN, IM, VIEWER]],
        ['AI summary & chat', ['ai.use'], [OWNER, ADMIN]],
        ['AI reorder plan', ['inventory.manage'], [OWNER, ADMIN, IM]],
        ['expense writes', ['expenses.manage'], [OWNER, ADMIN, IM, CASHIER]],
        ['schedule writes & sensitive expenses', ['schedule.manage'], [OWNER, ADMIN]],
        ['store settings, team, audit log', ['store.manage'], [OWNER, ADMIN]],
    ];

    it.each(cases)('%s', (_label, anyOf, roles) => {
        expect(allowed(anyOf)).toEqual([...roles].sort());
    });
});

describe('role permission overrides', () => {
    it('gives the owner every permission regardless of overrides', () => {
        expect(effectivePermissions(OWNER, { ADMIN: { 'store.manage': false } })).toEqual(PERMISSION_KEYS);
    });

    it('applies overrides on top of the defaults', () => {
        const perms = effectivePermissions(CASHIER, { CASHIER: { 'reports.view': true, 'expenses.manage': false } });
        expect(perms).toContain('reports.view');
        expect(perms).not.toContain('expenses.manage');
        expect(perms).toContain('pos.use');
    });

    it('lets a cashier void without being able to edit', () => {
        const perms = effectivePermissions(CASHIER, { CASHIER: { 'sales.void': true } });
        expect(perms).toContain('sales.void');
        expect(perms).not.toContain('sales.edit');
    });

    it('adds implied permissions (manage implies view)', () => {
        expect(effectivePermissions(CASHIER, { CASHIER: { 'inventory.manage': true } })).toContain('inventory.view');
    });

    it('stores only differences from the defaults and round-trips the matrix', () => {
        const matrix = { ...permissionMatrix({}), CASHIER: [...DEFAULT_ROLE_PERMISSIONS.CASHIER, 'reports.view' as const] };
        const overrides = overridesFromMatrix(matrix);
        expect(overrides).toEqual({ CASHIER: { 'reports.view': true } });
        const roundTripped = permissionMatrix(overrides);
        expect([...roundTripped.CASHIER].sort()).toEqual([...matrix.CASHIER].sort());
        expect(roundTripped.ADMIN).toEqual(matrix.ADMIN);
        expect(overridesFromMatrix(permissionMatrix({}))).toEqual({});
    });

    it('ignores unknown roles and permission keys in stored JSON', () => {
        expect(
            parseRolePermissionOverrides({ OWNER: { 'pos.use': false }, CASHIER: { bogus: true, 'pos.use': false } })
        ).toEqual({ CASHIER: { 'pos.use': false } });
    });
});

describe('requirePermission middleware', () => {
    const run = async (middleware: ReturnType<typeof requirePermission>) => {
        const req = { params: { storeId: 's1' }, user: { sub: 'u1', email: 'a@x', isSuperAdmin: false } } as never;
        const next = vi.fn();
        await middleware(req, {} as never, next);
        return { req: req as { permissions?: string[] }, error: next.mock.calls[0]?.[0] };
    };

    beforeEach(() => vi.clearAllMocks());

    it('allows a role that has the permission and attaches effective permissions', async () => {
        prismaMock.storeMember.findFirst.mockResolvedValue({
            role: CASHIER,
            suspendedAt: null,
            store: { rolePermissions: { CASHIER: { 'reports.view': true } } },
        } as never);
        const { req, error } = await run(requirePermission('reports.view'));
        expect(error).toBeUndefined();
        expect(req.permissions).toContain('reports.view');
    });

    it('rejects a role without the permission', async () => {
        prismaMock.storeMember.findFirst.mockResolvedValue({
            role: VIEWER,
            suspendedAt: null,
            store: { rolePermissions: {} },
        } as never);
        const { error } = await run(requirePermission('sales.edit'));
        expect(error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    });

    it('rejects suspended members and non-members', async () => {
        prismaMock.storeMember.findFirst.mockResolvedValueOnce({
            role: OWNER,
            suspendedAt: new Date(),
            store: { rolePermissions: {} },
        } as never);
        expect((await run(requireStoreMember())).error).toMatchObject({ code: 'MEMBER_SUSPENDED' });

        prismaMock.storeMember.findFirst.mockResolvedValueOnce(null);
        expect((await run(requireStoreMember())).error).toMatchObject({ code: 'FORBIDDEN' });
    });
});

describe('delegated team management', () => {
    beforeEach(() => vi.clearAllMocks());

    it('stops a non-admin manager from promoting someone to admin', async () => {
        prismaMock.storeMember.findFirst
            .mockResolvedValueOnce({ role: CASHIER } as never) // actor
            .mockResolvedValueOnce({ id: 'm2', userId: 'u2', role: VIEWER } as never); // target
        await expect(storeMemberService.updateMemberRole('s1', 'm2', ADMIN, 'u1')).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        expect(prismaMock.storeMember.updateMany).not.toHaveBeenCalled();
    });

    it('stops a non-admin manager from changing their own role', async () => {
        prismaMock.storeMember.findFirst
            .mockResolvedValueOnce({ role: CASHIER } as never)
            .mockResolvedValueOnce({ id: 'm1', userId: 'u1', role: CASHIER } as never);
        await expect(storeMemberService.updateMemberRole('s1', 'm1', IM, 'u1')).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
    });
});

describe('per-person permission exceptions', () => {
    beforeEach(() => vi.clearAllMocks());

    it('layers role defaults, the store grid, then personal exceptions', () => {
        const store = { CASHIER: { 'reports.view': true } };
        const perms = effectivePermissions(CASHIER, store, { 'reports.view': false, 'sales.void': true });
        expect(perms).toContain('sales.void');
        expect(perms).not.toContain('reports.view');
        expect(perms).toContain('pos.use');
        expect(effectivePermissions(OWNER, {}, { 'pos.use': false })).toEqual(PERMISSION_KEYS);
    });

    it('stores only the difference from the role, including implied permissions', () => {
        const baseline = effectivePermissions(CASHIER, {});
        expect(memberOverridesFromGranted([...baseline, 'sales.void'], baseline)).toEqual({ 'sales.void': true });
        expect(memberOverridesFromGranted(baseline, baseline)).toEqual({});
        expect(memberOverridesFromGranted([...baseline, 'inventory.manage'], baseline)).toEqual({
            'inventory.view': true,
            'inventory.manage': true,
        });
    });

    it('is applied by the permission middleware', async () => {
        prismaMock.storeMember.findFirst.mockResolvedValue({
            role: CASHIER,
            suspendedAt: null,
            permissionOverrides: { 'sales.void': true },
            store: { rolePermissions: {} },
        } as never);
        const next = vi.fn();
        await requirePermission('sales.void')(
            { params: { storeId: 's1' }, user: { sub: 'u1', email: 'a@x', isSuperAdmin: false } } as never,
            {} as never,
            next
        );
        expect(next).toHaveBeenCalledWith();
    });

    const memberRow = (overrides: Record<string, unknown> = {}) => ({
        id: 'm2',
        userId: 'u2',
        role: CASHIER,
        permissionOverrides: {},
        user: { id: 'u2', fullName: 'Ben', email: 'ben@x' },
        store: { rolePermissions: {} },
        ...overrides,
    });

    it('saves exceptions and audits the change', async () => {
        prismaMock.storeMember.findFirst
            .mockResolvedValueOnce(memberRow() as never)
            .mockResolvedValueOnce(memberRow({ permissionOverrides: { 'sales.void': true } }) as never);
        const result = await storeMemberService.updateMemberPermissions('s1', 'm2', 'owner-1', [
            'pos.use',
            'expenses.manage',
            'sales.void',
        ]);
        expect(prismaMock.storeMember.update.mock.calls[0]?.[0]).toMatchObject({
            where: { id: 'm2' },
            data: { permissionOverrides: { 'sales.void': true } },
        });
        expect(prismaMock.auditLog.create.mock.calls[0]?.[0]?.data).toMatchObject({
            action: 'MEMBER_PERMISSIONS_UPDATED',
            meta: { changes: [{ permission: 'sales.void', granted: true }] },
        });
        expect(result.effective).toContain('sales.void');
    });

    it('refuses owners and your own permissions', async () => {
        prismaMock.storeMember.findFirst.mockResolvedValueOnce(memberRow({ role: OWNER }) as never);
        await expect(storeMemberService.updateMemberPermissions('s1', 'm2', 'u1', [])).rejects.toMatchObject({
            code: 'INVALID_TARGET',
        });
        prismaMock.storeMember.findFirst.mockResolvedValueOnce(memberRow() as never);
        await expect(storeMemberService.updateMemberPermissions('s1', 'm2', 'u2', [])).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        expect(prismaMock.storeMember.update).not.toHaveBeenCalled();
    });

    it('clears exceptions when the role changes', async () => {
        prismaMock.storeMember.findFirst
            .mockResolvedValueOnce({ role: OWNER } as never) // actor
            .mockResolvedValueOnce({ id: 'm2', userId: 'u2', role: CASHIER } as never) // target
            .mockResolvedValueOnce(memberRow({ role: IM }) as never); // reloaded
        prismaMock.storeMember.updateMany.mockResolvedValue({ count: 1 } as never);
        await storeMemberService.updateMemberRole('s1', 'm2', IM, 'u1');
        expect(prismaMock.storeMember.updateMany.mock.calls[0]?.[0]?.data).toEqual({
            role: IM,
            permissionOverrides: {},
        });
    });
});
