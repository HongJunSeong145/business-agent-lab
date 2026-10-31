-- Phase 6: 작업물 버전의 원래 파일명(표시·내려받기용, 저장 키에는 쓰지 않음)
ALTER TABLE "deliverable_versions" ADD COLUMN "original_name" TEXT;
