-- AlterTable
ALTER TABLE "User" ADD COLUMN     "grantedPlan" "PlanTier",
ADD COLUMN     "grantedUntil" TIMESTAMP(3),
ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;
