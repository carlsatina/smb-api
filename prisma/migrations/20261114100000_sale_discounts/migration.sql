-- CreateEnum
CREATE TYPE "DiscountScope" AS ENUM ('LINE', 'SALE', 'BOTH');

-- CreateEnum
CREATE TYPE "DiscountMethod" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "FieldRequirement" AS ENUM ('OFF', 'OPTIONAL', 'REQUIRED');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "vatExemptSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vatRemoved" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "saleDiscountId" TEXT,
ADD COLUMN     "vatExemptSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vatRemoved" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DiscountType" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "statutory" BOOLEAN NOT NULL DEFAULT false,
    "method" "DiscountMethod" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "removesVat" BOOLEAN NOT NULL DEFAULT false,
    "scope" "DiscountScope" NOT NULL DEFAULT 'LINE',
    "holderName" "FieldRequirement" NOT NULL DEFAULT 'OFF',
    "holderIdNumber" "FieldRequirement" NOT NULL DEFAULT 'OFF',
    "allowOnChannels" BOOLEAN NOT NULL DEFAULT false,
    "roundToWhole" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "DiscountType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleDiscount" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "discountTypeId" TEXT NOT NULL,
    "scope" "DiscountScope" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" "DiscountMethod" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "removesVat" BOOLEAN NOT NULL,
    "holderName" TEXT,
    "holderIdNumber" TEXT,
    "dinerCount" INTEGER,
    "holderCount" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "vatRemoved" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "appliedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscountType_storeId_archivedAt_idx" ON "DiscountType"("storeId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountType_storeId_code_key" ON "DiscountType"("storeId", "code");

-- CreateIndex
CREATE INDEX "SaleDiscount_saleId_idx" ON "SaleDiscount"("saleId");

-- CreateIndex
CREATE INDEX "SaleDiscount_storeId_code_createdAt_idx" ON "SaleDiscount"("storeId", "code", "createdAt");

-- CreateIndex
CREATE INDEX "SaleItem_saleDiscountId_idx" ON "SaleItem"("saleDiscountId");

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleDiscountId_fkey" FOREIGN KEY ("saleDiscountId") REFERENCES "SaleDiscount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountType" ADD CONSTRAINT "DiscountType_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleDiscount" ADD CONSTRAINT "SaleDiscount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleDiscount" ADD CONSTRAINT "SaleDiscount_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleDiscount" ADD CONSTRAINT "SaleDiscount_discountTypeId_fkey" FOREIGN KEY ("discountTypeId") REFERENCES "DiscountType"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleDiscount" ADD CONSTRAINT "SaleDiscount_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Statutory presets for every existing store (also created on demand for new stores).
INSERT INTO "DiscountType" ("id", "storeId", "name", "code", "statutory", "method", "value", "removesVat", "scope", "holderName", "holderIdNumber", "allowOnChannels", "roundToWhole", "isActive", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, s."id", p."name", p."code", true, 'PERCENT', 20, true, 'BOTH', 'REQUIRED', 'REQUIRED', false, true, true, p."sortOrder", CURRENT_TIMESTAMP
FROM "Store" s
CROSS JOIN (VALUES ('Senior Citizen', 'SC', 0), ('Person with Disability', 'PWD', 1)) AS p("name", "code", "sortOrder")
ON CONFLICT ("storeId", "code") DO NOTHING;
