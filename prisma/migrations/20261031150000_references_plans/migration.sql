-- Phase 7: 레퍼런스(사용자 링크·파일, AI 검색, AI 예시안)와 기획안 버전 부가 정보
ALTER TABLE "reference_items" ADD COLUMN "content" TEXT;
ALTER TABLE "reference_items" ADD COLUMN "content_format" TEXT;
ALTER TABLE "reference_items" ADD COLUMN "points" JSONB;
ALTER TABLE "reference_items" ADD COLUMN "original_name" TEXT;
ALTER TABLE "reference_items" ADD COLUMN "mime" TEXT;
ALTER TABLE "reference_items" ADD COLUMN "created_by" UUID;
ALTER TABLE "reference_items" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "reference_items" ADD CONSTRAINT "reference_items_content_format_check" CHECK ("content_format" IS NULL OR "content_format" IN ('markdown', 'html', 'svg'));
CREATE INDEX "reference_items_task_id_idx" ON "reference_items"("task_id");

ALTER TABLE "plan_versions" ADD COLUMN "file_name" TEXT;
ALTER TABLE "plan_versions" ADD COLUMN "file_mime" TEXT;
ALTER TABLE "plan_versions" ADD COLUMN "note" TEXT;
