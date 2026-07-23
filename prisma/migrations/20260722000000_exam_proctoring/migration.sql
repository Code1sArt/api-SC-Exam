ALTER TABLE `ExamAttempt`
  ADD COLUMN `lockedAt` DATETIME(3) NULL,
  ADD COLUMN `lockReason` VARCHAR(191) NULL,
  ADD COLUMN `violationCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `lastViolationAt` DATETIME(3) NULL;

CREATE INDEX `ExamAttempt_lockedAt_idx` ON `ExamAttempt`(`lockedAt`);
