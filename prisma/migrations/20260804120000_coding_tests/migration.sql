-- Coding tests are exams whose problems are submitted as source code.
CREATE TABLE `CodingTest` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL,
  `classroomId` VARCHAR(191) NOT NULL, `subjectId` VARCHAR(191) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL, `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL, `status` ENUM('DRAFT','PUBLISHED','CLOSED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  `requiredCount` INTEGER NOT NULL, `durationMinutes` INTEGER NULL,
  `availableFrom` DATETIME(3) NULL, `availableUntil` DATETIME(3) NULL,
  `aiGradingEnabled` BOOLEAN NOT NULL DEFAULT true, `aiGradingModel` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), INDEX `CodingTest_organizationId_status_idx`(`organizationId`,`status`),
  INDEX `CodingTest_classroomId_subjectId_idx`(`classroomId`,`subjectId`),
  CONSTRAINT `CodingTest_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CodingTest_classroomId_fkey` FOREIGN KEY (`classroomId`) REFERENCES `Classroom`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CodingTest_subjectId_fkey` FOREIGN KEY (`subjectId`) REFERENCES `Subject`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CodingTest_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CodingTestProblem` (
  `id` VARCHAR(191) NOT NULL, `codingTestId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL, `description` TEXT NULL, `pdfUrl` VARCHAR(2048) NOT NULL,
  `language` ENUM('C','CPP','CSHARP','PYTHON') NOT NULL, `score` DECIMAL(8,2) NOT NULL,
  `position` INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (`id`),
  UNIQUE INDEX `CodingTestProblem_codingTestId_position_key`(`codingTestId`,`position`),
  CONSTRAINT `CodingTestProblem_codingTestId_fkey` FOREIGN KEY (`codingTestId`) REFERENCES `CodingTest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CodingTestAttempt` (
  `id` VARCHAR(191) NOT NULL, `codingTestId` VARCHAR(191) NOT NULL, `studentId` VARCHAR(191) NOT NULL,
  `status` ENUM('IN_PROGRESS','SUBMITTED','GRADED') NOT NULL DEFAULT 'IN_PROGRESS',
  `gradingStatus` ENUM('QUEUED','GRADING','GRADED','FAILED') NULL,
  `score` DECIMAL(10,2) NULL, `maxScore` DECIMAL(10,2) NULL, `percentage` DECIMAL(5,2) NULL,
  `lockedAt` DATETIME(3) NULL, `lockReason` VARCHAR(191) NULL, `violationCount` INTEGER NOT NULL DEFAULT 0,
  `lastViolationAt` DATETIME(3) NULL, `gradingError` TEXT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `submittedAt` DATETIME(3) NULL, `gradedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `CodingTestAttempt_codingTestId_studentId_key`(`codingTestId`,`studentId`),
  INDEX `CodingTestAttempt_studentId_status_idx`(`studentId`,`status`), INDEX `CodingTestAttempt_gradingStatus_submittedAt_idx`(`gradingStatus`,`submittedAt`),
  INDEX `CodingTestAttempt_lockedAt_idx`(`lockedAt`),
  CONSTRAINT `CodingTestAttempt_codingTestId_fkey` FOREIGN KEY (`codingTestId`) REFERENCES `CodingTest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CodingTestAttempt_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `StudentProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CodingTestAnswer` (
  `id` VARCHAR(191) NOT NULL, `attemptId` VARCHAR(191) NOT NULL, `problemId` VARCHAR(191) NOT NULL,
  `sourceCode` TEXT NOT NULL, `score` DECIMAL(8,2) NULL, `feedback` TEXT NULL,
  `aiConfidence` DECIMAL(5,4) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `gradedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `CodingTestAnswer_attemptId_problemId_key`(`attemptId`,`problemId`),
  CONSTRAINT `CodingTestAnswer_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `CodingTestAttempt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CodingTestAnswer_problemId_fkey` FOREIGN KEY (`problemId`) REFERENCES `CodingTestProblem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
