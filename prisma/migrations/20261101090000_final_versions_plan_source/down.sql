DELETE FROM "proposals" WHERE "source_type" = 'plan';
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_source_chk";
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_source_chk" CHECK ("source_type" IN ('meeting','manual','monitor'));
ALTER TABLE "deliverables" DROP COLUMN IF EXISTS "final_version_id";
