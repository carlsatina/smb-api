-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "paymentMethods" TEXT[] DEFAULT ARRAY['CASH', 'CARD', 'TRANSFER', 'GCASH', 'MAYA', 'OTHER']::TEXT[];
