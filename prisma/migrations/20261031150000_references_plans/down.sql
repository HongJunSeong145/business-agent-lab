DROP INDEX IF EXISTS "reference_items_task_id_idx";
ALTER TABLE "reference_items" DROP CONSTRAINT IF EXISTS "reference_items_content_format_check";
ALTER TABLE "reference_items" DROP COLUMN IF EXISTS "content", DROP COLUMN IF EXISTS "content_format", DROP COLUMN IF EXISTS "points",
  DROP COLUMN IF EXISTS "original_name", DROP COLUMN IF EXISTS "mime", DROP COLUMN IF EXISTS "created_by", DROP COLUMN IF EXISTS "deleted_at";
ALTER TABLE "plan_versions" DROP COLUMN IF EXISTS "file_name", DROP COLUMN IF EXISTS "file_mime", DROP COLUMN IF EXISTS "note";
