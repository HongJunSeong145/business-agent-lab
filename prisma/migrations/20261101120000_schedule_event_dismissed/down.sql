UPDATE "schedule_events" SET "state" = 'proposed' WHERE "state" = 'dismissed';
ALTER TABLE "schedule_events" DROP CONSTRAINT "se_state_chk";
ALTER TABLE "schedule_events" ADD CONSTRAINT "se_state_chk" CHECK ("state" IN ('proposed','confirmed'));
