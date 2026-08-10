-- Allow administrators to correct the displayed result scale without changing
-- question weights or invalidating answers that have already been graded.
ALTER TABLE `Exam`
  ADD COLUMN `resultMaxScore` DECIMAL(10, 2) NULL;
