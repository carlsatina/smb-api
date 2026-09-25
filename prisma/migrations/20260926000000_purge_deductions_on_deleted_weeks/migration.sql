-- Deleting a schedule week used to leave its cash-advance deductions behind,
-- so they kept reducing balances and blocked deleting the advance. Deleting a
-- week now removes them; this clears the ones left by earlier deletions.
DELETE FROM "CashAdvanceDeduction" d
USING "ScheduleWeekRow" r, "ScheduleWeek" w
WHERE d."scheduleWeekRowId" = r."id"
  AND r."scheduleWeekId" = w."id"
  AND w."deletedAt" IS NOT NULL;
