ALTER TABLE `Assignment`
  MODIFY `minGroupSize` INTEGER NOT NULL DEFAULT 1;

ALTER TABLE `AssignmentSubmission`
  ADD COLUMN `attachmentUrls` JSON NULL;
