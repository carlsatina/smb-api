-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "salesChannels" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "channelPrices" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "channel" TEXT;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "basePrice" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "Sale_storeId_channel_createdAt_idx" ON "Sale"("storeId", "channel", "createdAt");
