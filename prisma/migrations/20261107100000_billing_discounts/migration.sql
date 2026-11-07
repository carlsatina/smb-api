-- Owner discounts and complimentary (free) stores for per-store billing.

-- CreateEnum
CREATE TYPE "BillingDiscountType" AS ENUM ('PERCENT', 'FIXED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "billingDiscountEndsAt" TIMESTAMP(3),
ADD COLUMN     "billingDiscountNote" TEXT,
ADD COLUMN     "billingDiscountType" "BillingDiscountType",
ADD COLUMN     "billingDiscountValue" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "BillingStatement" ADD COLUMN     "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountNote" TEXT,
ADD COLUMN     "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "billingExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "billingExemptEndsAt" TIMESTAMP(3),
ADD COLUMN     "billingExemptNote" TEXT;


-- Statements created before discounts existed: subtotal equals the billed amount.
UPDATE "BillingStatement" SET "subtotal" = "amount";
