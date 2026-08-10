ALTER TABLE `CodingTest` ADD COLUMN `fullScore` DECIMAL(8, 2) NOT NULL DEFAULT 10;

UPDATE `CodingTest` AS ct
SET `fullScore` = COALESCE(
  (SELECT SUM(`score`) FROM `CodingTestProblem` AS cp WHERE cp.`codingTestId` = ct.`id`),
  10
);

UPDATE `CodingTestAttempt` AS ca
INNER JOIN `CodingTest` AS ct ON ct.`id` = ca.`codingTestId`
SET ca.`maxScore` = ct.`fullScore`
WHERE ca.`maxScore` IS NOT NULL;
