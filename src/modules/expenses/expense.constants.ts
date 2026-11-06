import type { PermissionKey } from '../../shared/permissions';

// Categories that contain sensitive financial info (rent, payroll). Only store
// owners and admins may see expenses in these categories; cashiers, inventory
// managers, and viewers never receive them from the API. Matched case-insensitively
// against the (free-text, per-store) expense category name.
export const RESTRICTED_EXPENSE_CATEGORIES = ['rent', 'salaries'];

export const isRestrictedCategory = (category: string) =>
    RESTRICTED_EXPENSE_CATEGORIES.includes(category.trim().toLowerCase());

// Sensitive (rent, salaries) expenses follow the payroll permission.
export const canViewRestrictedExpenses = (permissions: readonly PermissionKey[] | undefined | null) =>
    Boolean(permissions?.includes('schedule.manage'));
