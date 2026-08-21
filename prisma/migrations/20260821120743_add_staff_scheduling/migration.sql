-- CreateEnum
CREATE TYPE "ScheduleWeekStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "ShiftPreset" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ShiftPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffCompensation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeMemberId" TEXT NOT NULL,
    "dailyRate" DECIMAL(12,2) NOT NULL,
    "hoursPerDay" DECIMAL(4,2) NOT NULL DEFAULT 8,
    "otMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffCompensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleWeek" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" "ScheduleWeekStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ScheduleWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleWeekRow" (
    "id" TEXT NOT NULL,
    "scheduleWeekId" TEXT NOT NULL,
    "storeMemberId" TEXT NOT NULL,
    "otHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "dailyRate" DECIMAL(12,2),
    "otHourlyRate" DECIMAL(12,2),
    "daysWorked" INTEGER,
    "lessCa" DECIMAL(12,2),
    "payout" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleWeekRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleShift" (
    "id" TEXT NOT NULL,
    "scheduleWeekRowId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isRestDay" BOOLEAN NOT NULL DEFAULT false,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "presetId" TEXT,

    CONSTRAINT "ScheduleShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAdvance" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeMemberId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "takenOn" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CashAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAdvanceDeduction" (
    "id" TEXT NOT NULL,
    "cashAdvanceId" TEXT NOT NULL,
    "scheduleWeekRowId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashAdvanceDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftPreset_storeId_sortOrder_idx" ON "ShiftPreset"("storeId", "sortOrder");

-- CreateIndex
CREATE INDEX "StaffCompensation_storeMemberId_effectiveFrom_idx" ON "StaffCompensation"("storeMemberId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "StaffCompensation_storeId_idx" ON "StaffCompensation"("storeId");

-- CreateIndex
CREATE INDEX "ScheduleWeek_storeId_weekStart_idx" ON "ScheduleWeek"("storeId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleWeek_storeId_weekStart_key" ON "ScheduleWeek"("storeId", "weekStart");

-- CreateIndex
CREATE INDEX "ScheduleWeekRow_scheduleWeekId_idx" ON "ScheduleWeekRow"("scheduleWeekId");

-- CreateIndex
CREATE INDEX "ScheduleWeekRow_storeMemberId_idx" ON "ScheduleWeekRow"("storeMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleWeekRow_scheduleWeekId_storeMemberId_key" ON "ScheduleWeekRow"("scheduleWeekId", "storeMemberId");

-- CreateIndex
CREATE INDEX "ScheduleShift_scheduleWeekRowId_idx" ON "ScheduleShift"("scheduleWeekRowId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleShift_scheduleWeekRowId_date_key" ON "ScheduleShift"("scheduleWeekRowId", "date");

-- CreateIndex
CREATE INDEX "CashAdvance_storeId_storeMemberId_idx" ON "CashAdvance"("storeId", "storeMemberId");

-- CreateIndex
CREATE INDEX "CashAdvance_storeMemberId_takenOn_idx" ON "CashAdvance"("storeMemberId", "takenOn");

-- CreateIndex
CREATE INDEX "CashAdvanceDeduction_scheduleWeekRowId_idx" ON "CashAdvanceDeduction"("scheduleWeekRowId");

-- CreateIndex
CREATE UNIQUE INDEX "CashAdvanceDeduction_cashAdvanceId_scheduleWeekRowId_key" ON "CashAdvanceDeduction"("cashAdvanceId", "scheduleWeekRowId");

-- AddForeignKey
ALTER TABLE "ShiftPreset" ADD CONSTRAINT "ShiftPreset_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCompensation" ADD CONSTRAINT "StaffCompensation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCompensation" ADD CONSTRAINT "StaffCompensation_storeMemberId_fkey" FOREIGN KEY ("storeMemberId") REFERENCES "StoreMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCompensation" ADD CONSTRAINT "StaffCompensation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleWeek" ADD CONSTRAINT "ScheduleWeek_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleWeek" ADD CONSTRAINT "ScheduleWeek_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleWeekRow" ADD CONSTRAINT "ScheduleWeekRow_scheduleWeekId_fkey" FOREIGN KEY ("scheduleWeekId") REFERENCES "ScheduleWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleWeekRow" ADD CONSTRAINT "ScheduleWeekRow_storeMemberId_fkey" FOREIGN KEY ("storeMemberId") REFERENCES "StoreMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleShift" ADD CONSTRAINT "ScheduleShift_scheduleWeekRowId_fkey" FOREIGN KEY ("scheduleWeekRowId") REFERENCES "ScheduleWeekRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleShift" ADD CONSTRAINT "ScheduleShift_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "ShiftPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_storeMemberId_fkey" FOREIGN KEY ("storeMemberId") REFERENCES "StoreMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceDeduction" ADD CONSTRAINT "CashAdvanceDeduction_cashAdvanceId_fkey" FOREIGN KEY ("cashAdvanceId") REFERENCES "CashAdvance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvanceDeduction" ADD CONSTRAINT "CashAdvanceDeduction_scheduleWeekRowId_fkey" FOREIGN KEY ("scheduleWeekRowId") REFERENCES "ScheduleWeekRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
