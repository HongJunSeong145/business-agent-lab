-- Phase 9: 증빙 파일 표시용 원래 파일명·형식, 소프트 삭제
ALTER TABLE "evidence_items" ADD COLUMN "original_name" TEXT;
ALTER TABLE "evidence_items" ADD COLUMN "mime" TEXT;
ALTER TABLE "evidence_items" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
