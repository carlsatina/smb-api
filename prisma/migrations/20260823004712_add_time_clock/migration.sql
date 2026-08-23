-- CreateEnum
CREATE TYPE "TimeEntrySource" AS ENUM ('SELF', 'MANAGER');

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeMemberId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "clockInAt" TIMESTAMP(3) NOT NULL,
    "clockOutAt" TIMESTAMP(3),
    "scheduleShiftId" TEXT,
    "source" "TimeEntrySource" NOT NULL DEFAULT 'SELF',
    "note" TEXT,
    "editedById" TEXT,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeEntry_storeId_workDate_idx" ON "TimeEntry"("storeId", "workDate");

-- CreateIndex
CREATE INDEX "TimeEntry_storeMemberId_workDate_idx" ON "TimeEntry"("storeMemberId", "workDate");

-- CreateIndex
CREATE INDEX "TimeEntry_scheduleShiftId_idx" ON "TimeEntry"("scheduleShiftId");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_storeMemberId_fkey" FOREIGN KEY ("storeMemberId") REFERENCES "StoreMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_scheduleShiftId_fkey" FOREIGN KEY ("scheduleShiftId") REFERENCES "ScheduleShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
