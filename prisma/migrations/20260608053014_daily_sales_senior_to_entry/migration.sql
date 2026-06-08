/*
  Warnings:

  - You are about to drop the column `seniorDiscount` on the `DailySalesCashierEntry` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "DailySalesCashierEntry" DROP COLUMN "seniorDiscount";

-- AlterTable
ALTER TABLE "DailySalesEntry" ADD COLUMN     "seniorDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0;
