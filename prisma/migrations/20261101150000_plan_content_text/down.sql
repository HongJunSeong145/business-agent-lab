DROP INDEX IF EXISTS "plan_versions_source_deliverable_version_id_key";
ALTER TABLE "plan_versions" DROP COLUMN IF EXISTS "source_deliverable_version_id";
ALTER TABLE "plan_versions" DROP COLUMN IF EXISTS "content_text";
