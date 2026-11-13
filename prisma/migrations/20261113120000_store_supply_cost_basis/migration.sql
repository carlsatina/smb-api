-- CreateEnum
CREATE TYPE "SupplyCostBasis" AS ENUM ('PURCHASE', 'USAGE');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "supplyCostBasis" "SupplyCostBasis" NOT NULL DEFAULT 'PURCHASE';
