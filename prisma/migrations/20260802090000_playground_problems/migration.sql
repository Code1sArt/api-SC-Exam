CREATE TABLE `PlaygroundProblem` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `difficulty` ENUM('VERY_EASY', 'EASY', 'MEDIUM', 'HARD', 'VERY_HARD') NOT NULL,
  `driveUrl` VARCHAR(2048) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `position` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `PlaygroundProblem_org_active_level_pos_idx` (`organizationId`, `isActive`, `difficulty`, `position`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PlaygroundProblem`
  ADD CONSTRAINT `PlaygroundProblem_organizationId_fkey`
  FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
