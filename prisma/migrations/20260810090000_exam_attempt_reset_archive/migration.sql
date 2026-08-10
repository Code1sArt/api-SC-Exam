-- Keep an immutable snapshot before an administrator resets an exam result.
CREATE TABLE `ExamAttemptResetArchive` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `examId` VARCHAR(191) NOT NULL,
  `examCreatedById` VARCHAR(191) NOT NULL,
  `studentId` VARCHAR(191) NOT NULL,
  `resetById` VARCHAR(191) NOT NULL,
  `resetByName` VARCHAR(191) NOT NULL,
  `examTitle` VARCHAR(191) NOT NULL,
  `studentCode` VARCHAR(191) NOT NULL,
  `studentName` VARCHAR(191) NOT NULL,
  `attemptCount` INTEGER NOT NULL,
  `snapshot` JSON NOT NULL,
  `resetAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `restoredAt` DATETIME(3) NULL,
  `restoredById` VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  INDEX `ExamAttemptResetArchive_organizationId_restoredAt_resetAt_idx`(`organizationId`, `restoredAt`, `resetAt`),
  INDEX `ExamAttemptResetArchive_examCreatedById_restoredAt_idx`(`examCreatedById`, `restoredAt`),
  INDEX `ExamAttemptResetArchive_examId_studentId_idx`(`examId`, `studentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
