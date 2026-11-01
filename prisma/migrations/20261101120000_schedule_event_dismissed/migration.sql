-- 일정 항목(행정실 송부 마감 등) '삭제됨' 상태: 규칙 재계산으로 되살아나지 않게 지우지 않고 표시만 한다(되살리기 가능)
ALTER TABLE "schedule_events" DROP CONSTRAINT "se_state_chk";
ALTER TABLE "schedule_events" ADD CONSTRAINT "se_state_chk" CHECK ("state" IN ('proposed','confirmed','dismissed'));
