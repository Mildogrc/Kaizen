UPDATE "ContentSchemaVersion"
SET "config" = '{}'
WHERE "schemaId" IN (
  SELECT "id" FROM "ContentSchema" WHERE "slug" = 'nato-alphabet'
);
