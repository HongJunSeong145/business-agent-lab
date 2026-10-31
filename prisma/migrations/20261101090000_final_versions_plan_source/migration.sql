-- 작업물 최종본 지정 + 결재 기획안 기준 재배정 제안(source_type = 'plan')
ALTER TABLE "deliverables" ADD COLUMN "final_version_id" UUID;
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_source_chk";
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_source_chk" CHECK ("source_type" IN ('meeting','manual','monitor','plan'));
