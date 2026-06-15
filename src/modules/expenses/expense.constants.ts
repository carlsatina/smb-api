import { Role } from '@prisma/client';

// Categories that contain sensitive financial info (rent, payroll). Only store
// owners and admins may see expenses in these categories; cashiers, inventory
// managers, and viewers never receive them from the API. Matched case-insensitively
// against the (free-text, per-store) expense category name.
export const RESTRICTED_EXPENSE_CATEGORIES = ['rent', 'salaries'];

export const isRestrictedCategory = (category: string) =>
    RESTRICTED_EXPENSE_CATEGORIES.includes(category.trim().toLowerCase());

export const canViewRestrictedExpenses = (role: Role | undefined | null) =>
    role === Role.OWNER || role === Role.ADMIN;
