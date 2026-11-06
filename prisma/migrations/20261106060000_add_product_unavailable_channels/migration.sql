-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "unavailableChannels" TEXT[] DEFAULT ARRAY[]::TEXT[];
