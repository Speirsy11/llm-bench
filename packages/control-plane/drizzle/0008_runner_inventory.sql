ALTER TABLE "runners"
ADD COLUMN "inventory" jsonb DEFAULT '{"plugins":[],"mcpProfiles":[]}'::jsonb NOT NULL;

ALTER TABLE "runners"
ALTER COLUMN "protocol_version" SET DEFAULT '3.0';

UPDATE "runners"
SET "status" = 'disabled'
WHERE "protocol_version" <> '3.0'
  AND "revoked_at" IS NULL;
