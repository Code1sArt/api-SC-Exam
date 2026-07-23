ALTER TABLE `Assignment`
  ADD COLUMN `isGroupWork` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `minGroupSize` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `maxGroupSize` INTEGER NOT NULL DEFAULT 5;

ALTER TABLE `AssignmentSubmission`
  ADD COLUMN `groupName` VARCHAR(191) NULL,
  ADD COLUMN `gradingMode` ENUM('SHARED', 'INDIVIDUAL') NULL;

CREATE TABLE `AssignmentSubmissionMember` (
  `id` VARCHAR(191) NOT NULL,
  `assignmentId` VARCHAR(191) NOT NULL,
  `submissionId` VARCHAR(191) NOT NULL,
  `studentId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NOT NULL,
  `score` DECIMAL(8, 2) NULL,
  `feedback` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `AssignmentSubmissionMember_assignmentId_studentId_key`(`assignmentId`, `studentId`),
  INDEX `AssignmentSubmissionMember_submissionId_idx`(`submissionId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AssignmentSubmissionMember`
  ADD CONSTRAINT `AssignmentSubmissionMember_submissionId_fkey`
  FOREIGN KEY (`submissionId`) REFERENCES `AssignmentSubmission`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `AssignmentSubmissionMember`
  ADD CONSTRAINT `AssignmentSubmissionMember_studentId_fkey`
  FOREIGN KEY (`studentId`) REFERENCES `StudentProfile`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
