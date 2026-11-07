-- Read-only lock on an owner's stores for non-payment.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "billingSuspendedAt" TIMESTAMP(3),
ADD COLUMN     "billingSuspendedReason" TEXT;

