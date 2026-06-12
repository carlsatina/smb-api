-- DropIndex
DROP INDEX "BillingNotice_storeId_idx";

-- DropIndex
DROP INDEX "BillingNotice_storeId_year_month_key";

-- CreateIndex
CREATE INDEX "BillingNotice_storeId_year_month_idx" ON "BillingNotice"("storeId", "year", "month");

-- CreateIndex
CREATE INDEX "BillingNotice_sentAt_idx" ON "BillingNotice"("sentAt");
