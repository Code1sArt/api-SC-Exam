ALTER TABLE `Exam`
  ADD COLUMN `questionCount` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `essayQuestionCount` INTEGER NULL;

UPDATE `Exam` AS `exam`
SET `questionCount` = (
  SELECT COUNT(*)
  FROM `ExamItem` AS `item`
  WHERE `item`.`examId` = `exam`.`id`
);
