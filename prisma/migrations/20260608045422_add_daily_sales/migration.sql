-- CreateTable
CREATE TABLE "UserFeature" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "grantedById" TEXT NOT NULL,

    CONSTRAINT "UserFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySalesGoal" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "goal" DECIMAL(12,2) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailySalesGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySalesEntry" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "expense" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "actualCoh" DECIMAL(12,2),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DailySalesEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySalesCashierEntry" (
    "id" TEXT NOT NULL,
    "dailySalesEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cashAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gcashAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "seniorDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "denom1000" INTEGER NOT NULL DEFAULT 0,
    "denom500" INTEGER NOT NULL DEFAULT 0,
    "denom200" INTEGER NOT NULL DEFAULT 0,
    "denom100" INTEGER NOT NULL DEFAULT 0,
    "denom50" INTEGER NOT NULL DEFAULT 0,
    "denom20" INTEGER NOT NULL DEFAULT 0,
    "coins" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySalesCashierEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserFeature_userId_idx" ON "UserFeature"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserFeature_userId_feature_key" ON "UserFeature"("userId", "feature");

-- CreateIndex
CREATE INDEX "DailySalesGoal_storeId_effectiveDate_idx" ON "DailySalesGoal"("storeId", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailySalesGoal_storeId_effectiveDate_key" ON "DailySalesGoal"("storeId", "effectiveDate");

-- CreateIndex
CREATE INDEX "DailySalesEntry_storeId_date_idx" ON "DailySalesEntry"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailySalesEntry_storeId_date_key" ON "DailySalesEntry"("storeId", "date");

-- CreateIndex
CREATE INDEX "DailySalesCashierEntry_dailySalesEntryId_idx" ON "DailySalesCashierEntry"("dailySalesEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "DailySalesCashierEntry_dailySalesEntryId_userId_key" ON "DailySalesCashierEntry"("dailySalesEntryId", "userId");

-- AddForeignKey
ALTER TABLE "UserFeature" ADD CONSTRAINT "UserFeature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFeature" ADD CONSTRAINT "UserFeature_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySalesGoal" ADD CONSTRAINT "DailySalesGoal_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySalesGoal" ADD CONSTRAINT "DailySalesGoal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySalesEntry" ADD CONSTRAINT "DailySalesEntry_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySalesEntry" ADD CONSTRAINT "DailySalesEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySalesCashierEntry" ADD CONSTRAINT "DailySalesCashierEntry_dailySalesEntryId_fkey" FOREIGN KEY ("dailySalesEntryId") REFERENCES "DailySalesEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySalesCashierEntry" ADD CONSTRAINT "DailySalesCashierEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
