CREATE TABLE `CodingTestCase` (
  `id` VARCHAR(191) NOT NULL,
  `problemId` VARCHAR(191) NOT NULL,
  `input` TEXT NOT NULL,
  `expectedOutput` TEXT NOT NULL,
  `position` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `CodingTestCase_problemId_position_key`(`problemId`, `position`),
  CONSTRAINT `CodingTestCase_problemId_fkey` FOREIGN KEY (`problemId`) REFERENCES `CodingTestProblem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CodingTestAnswer`
  ADD COLUMN `passedTestCases` INTEGER NULL,
  ADD COLUMN `totalTestCases` INTEGER NULL,
  ADD COLUMN `testResults` JSON NULL;
