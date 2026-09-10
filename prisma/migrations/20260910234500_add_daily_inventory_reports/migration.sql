-- CreateEnum
CREATE TYPE "DailyInventoryReportType" AS ENUM ('TAKOYAKI', 'BUKO', 'CUSTOM');

-- CreateTable
CREATE TABLE "DailyInventoryReport" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reportType" "DailyInventoryReportType" NOT NULL DEFAULT 'TAKOYAKI',
    "date" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyInventoryReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyInventoryReportItem" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "section" TEXT,
    "particulars" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "openingInventory" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "delivery" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "endingInventory" DECIMAL(12,4),
    "reminders" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "itemType" "ItemType",
    "itemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyInventoryReportItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyInventoryReport_storeId_reportType_date_idx" ON "DailyInventoryReport"("storeId", "reportType", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyInventoryReport_storeId_reportType_date_key" ON "DailyInventoryReport"("storeId", "reportType", "date");

-- CreateIndex
CREATE INDEX "DailyInventoryReportItem_reportId_idx" ON "DailyInventoryReportItem"("reportId");

-- AddForeignKey
ALTER TABLE "DailyInventoryReport" ADD CONSTRAINT "DailyInventoryReport_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyInventoryReport" ADD CONSTRAINT "DailyInventoryReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyInventoryReportItem" ADD CONSTRAINT "DailyInventoryReportItem_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyInventoryReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
