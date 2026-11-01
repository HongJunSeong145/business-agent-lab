-- 기획안 본문(첨부·작업물에서 추출한 글자)과 어느 작업물 버전에서 가져왔는지 — 레퍼런스·평가·재배정이 기획안 내용을 읽는다
ALTER TABLE "plan_versions" ADD COLUMN "content_text" TEXT;
ALTER TABLE "plan_versions" ADD COLUMN "source_deliverable_version_id" UUID;
CREATE UNIQUE INDEX "plan_versions_source_deliverable_version_id_key" ON "plan_versions"("source_deliverable_version_id");
