-- CreateEnum
CREATE TYPE "ExpenseSource" AS ENUM ('MANUAL', 'DAILY_SALES');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "source" "ExpenseSource" NOT NULL DEFAULT 'MANUAL';
