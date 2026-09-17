ALTER TABLE `Enrollment` ADD COLUMN `studentNumber` INTEGER NULL;

CREATE UNIQUE INDEX `Enrollment_classroomId_studentNumber_key`
  ON `Enrollment`(`classroomId`, `studentNumber`);
