import { Prisma, Role } from '@prisma/client';

/**
 * Store permissions. Kept deliberately coarse: each one is a single checkbox per
 * role on the Roles & permissions page. Routes check these instead of role lists.
 *
 * Always open to every store member (no permission): viewing sales history,
 * expenses (non-sensitive), the schedule and the team list.
 * Customer-specific features (daily inventory report, daily sales) sit outside the
 * grid on fixed role rules plus their per-user DAILY_SALES feature.
 * Always owner-only (never delegable): editing permissions, deleting the store,
 * customising sale dates, and assigning the Owner role.
 */
export const PERMISSIONS = [
    {
        key: 'pos.use',
        group: 'Sales',
        label: 'Use the POS',
        description: 'Ring up sales at the point of sale.',
    },
    {
        key: 'sales.void',
        group: 'Sales',
        label: 'Void sales',
        description: 'Void a finalized sale; its stock goes back to inventory.',
    },
    {
        key: 'sales.edit',
        group: 'Sales',
        label: 'Edit & import sales',
        description: 'Change the items, prices or payment of past sales, and import sales from CSV.',
    },
    {
        key: 'inventory.view',
        group: 'Inventory',
        label: 'View products & stock',
        description: 'See products, ingredients, recipes, stock levels, suppliers and purchase orders.',
    },
    {
        key: 'inventory.manage',
        group: 'Inventory',
        label: 'Manage products & stock',
        description:
            'Add and edit products, ingredients, recipes and suppliers; adjust and transfer stock; create and receive purchase orders; import catalog CSVs.',
        implies: ['inventory.view'],
    },
    {
        key: 'reports.view',
        group: 'Reports & expenses',
        label: 'View reports',
        description: 'Sales, profit, product, payment and staff reports.',
    },
    {
        key: 'ai.use',
        group: 'Reports & expenses',
        label: 'Use AI insights',
        description: "Daily AI summary and AI chat (uses the store's AI key).",
    },
    {
        key: 'expenses.manage',
        group: 'Reports & expenses',
        label: 'Record expenses',
        description: 'Add, edit and delete expenses.',
    },
    {
        key: 'schedule.manage',
        group: 'Team & store',
        label: 'Manage schedules & payroll',
        description:
            'Build and publish schedules, edit time entries, set pay rates and cash advances, and see rent and salary expenses.',
    },
    {
        key: 'store.manage',
        group: 'Team & store',
        label: 'Manage store & team',
        description:
            'Store settings, catalog defaults, inviting and managing members, and the audit log. Non-admins can only manage roles below Admin.',
    },
] as const satisfies ReadonlyArray<{
    key: string;
    group: string;
    label: string;
    description: string;
    implies?: readonly string[];
}>;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((permission) => permission.key);

const isPermissionKey = (value: unknown): value is PermissionKey =>
    typeof value === 'string' && (PERMISSION_KEYS as string[]).includes(value);

/** Roles whose permissions an owner can customise. Owner always has everything. */
export const EDITABLE_ROLES = [Role.ADMIN, Role.INVENTORY_MANAGER, Role.CASHIER, Role.VIEWER] as const;
export type EditableRole = (typeof EDITABLE_ROLES)[number];

const isEditableRole = (value: unknown): value is EditableRole =>
    typeof value === 'string' && (EDITABLE_ROLES as readonly string[]).includes(value);

/** Defaults reproduce the role rules that were hard-coded on each route. */
export const DEFAULT_ROLE_PERMISSIONS: Record<EditableRole, PermissionKey[]> = {
    ADMIN: [
        'pos.use',
        'sales.void',
        'sales.edit',
        'inventory.view',
        'inventory.manage',
        'reports.view',
        'ai.use',
        'expenses.manage',
        'schedule.manage',
        'store.manage',
    ],
    INVENTORY_MANAGER: ['inventory.view', 'inventory.manage', 'reports.view', 'expenses.manage'],
    CASHIER: ['pos.use', 'expenses.manage'],
    VIEWER: ['inventory.view', 'reports.view'],
};

/** Stored per store: only the differences from the defaults (permission -> granted). */
export type RolePermissionOverrides = Partial<Record<EditableRole, Partial<Record<PermissionKey, boolean>>>>;

export const parseRolePermissionOverrides = (value: Prisma.JsonValue | null | undefined): RolePermissionOverrides => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: RolePermissionOverrides = {};
    Object.entries(value).forEach(([role, entries]) => {
        if (!isEditableRole(role) || !entries || typeof entries !== 'object' || Array.isArray(entries)) return;
        const roleOverrides: Partial<Record<PermissionKey, boolean>> = {};
        Object.entries(entries).forEach(([key, granted]) => {
            if (isPermissionKey(key) && typeof granted === 'boolean') roleOverrides[key] = granted;
        });
        if (Object.keys(roleOverrides).length) result[role] = roleOverrides;
    });
    return result;
};

/** Adds permissions implied by the given ones (e.g. manage implies view). */
export const withImplied = (permissions: Iterable<PermissionKey>): PermissionKey[] => {
    const set = new Set<PermissionKey>(permissions);
    PERMISSIONS.forEach((permission) => {
        if (set.has(permission.key) && 'implies' in permission) {
            permission.implies.forEach((implied) => set.add(implied));
        }
    });
    return PERMISSION_KEYS.filter((key) => set.has(key));
};

export const effectivePermissions = (role: Role, overrides: RolePermissionOverrides): PermissionKey[] => {
    if (role === Role.OWNER) return [...PERMISSION_KEYS];
    if (!isEditableRole(role)) return [];
    const set = new Set<PermissionKey>(DEFAULT_ROLE_PERMISSIONS[role]);
    Object.entries(overrides[role] ?? {}).forEach(([key, granted]) => {
        if (granted) set.add(key as PermissionKey);
        else set.delete(key as PermissionKey);
    });
    return withImplied(set);
};

export const permissionMatrix = (overrides: RolePermissionOverrides): Record<EditableRole, PermissionKey[]> => ({
    ADMIN: effectivePermissions(Role.ADMIN, overrides),
    INVENTORY_MANAGER: effectivePermissions(Role.INVENTORY_MANAGER, overrides),
    CASHIER: effectivePermissions(Role.CASHIER, overrides),
    VIEWER: effectivePermissions(Role.VIEWER, overrides),
});

/** Converts a full matrix (role -> granted keys) into the minimal overrides to store. */
export const overridesFromMatrix = (
    matrix: Partial<Record<EditableRole, PermissionKey[]>>,
    current: RolePermissionOverrides = {}
): RolePermissionOverrides => {
    const result: RolePermissionOverrides = {};
    EDITABLE_ROLES.forEach((role) => {
        const granted = new Set(
            matrix[role] !== undefined ? withImplied(matrix[role]) : effectivePermissions(role, current)
        );
        const defaults = new Set(DEFAULT_ROLE_PERMISSIONS[role]);
        const diff: Partial<Record<PermissionKey, boolean>> = {};
        PERMISSION_KEYS.forEach((key) => {
            if (granted.has(key) !== defaults.has(key)) diff[key] = granted.has(key);
        });
        if (Object.keys(diff).length) result[role] = diff;
    });
    return result;
};
