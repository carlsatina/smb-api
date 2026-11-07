-- Business model change: subscription plans replaced by per-store monthly billing.

-- DropForeignKey
ALTER TABLE "BillingNotice" DROP CONSTRAINT "BillingNotice_storeId_fkey";

-- DropForeignKey
ALTER TABLE "BillingNotice" DROP CONSTRAINT "BillingNotice_sentById_fkey";

-- DropTable
DROP TABLE "BillingNotice";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "grantedPlan",
DROP COLUMN "grantedUntil",
DROP COLUMN "payPerReceipt",
DROP COLUMN "planTier",
DROP COLUMN "subscriptionActive";

-- DropEnum
DROP TYPE "PlanTier";

-- CreateTable
CREATE TABLE "BillingStatement" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "storeCount" INTEGER NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "amount" DECIMAL(12,2) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentToEmail" TEXT,
    "sentById" TEXT,
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paymentNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingStatement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingStatement_year_month_idx" ON "BillingStatement"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "BillingStatement_ownerId_year_month_key" ON "BillingStatement"("ownerId", "year", "month");

-- AddForeignKey
ALTER TABLE "BillingStatement" ADD CONSTRAINT "BillingStatement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingStatement" ADD CONSTRAINT "BillingStatement_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
