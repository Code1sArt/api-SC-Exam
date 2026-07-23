-- Preserve exam history while allowing classrooms to be removed from active use.
ALTER TABLE `Classroom`
  ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;
