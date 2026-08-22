-- AlterTable
ALTER TABLE "ScheduleWeekRow" ADD COLUMN     "otAuto" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "StaffCompensation" ADD COLUMN     "breakMinutes" INTEGER NOT NULL DEFAULT 0;
