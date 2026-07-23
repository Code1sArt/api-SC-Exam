-- Active classroom uniqueness is enforced in the service so archived names can be reused.
ALTER TABLE `Classroom`
  DROP INDEX `Classroom_organizationId_name_academicYear_key`,
  ADD INDEX `Classroom_organizationId_name_academicYear_idx` (`organizationId`, `name`, `academicYear`);
