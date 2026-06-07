-- CreateEnum
CREATE TYPE "StoreType" AS ENUM ('RETAIL', 'WAREHOUSE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MovementType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "MovementType" ADD VALUE 'TRANSFER_IN';

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "counterpartMovementId" TEXT,
ADD COLUMN     "counterpartStoreId" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "storeType" "StoreType" NOT NULL DEFAULT 'RETAIL';
