import { kstDateString } from "@/lib/utils";

/**
 * 오늘 날짜(Asia/Seoul). 테스트 환경(APP_ENV=test)에서만 KGB_FAKE_TODAY 로 고정할 수 있다 —
 * T5·T6 처럼 날짜에 따라 결과가 달라지는 시나리오를 언제 실행해도 같게 검증하기 위함.
 */
export function todayKst(): string {
  const fake = process.env.KGB_FAKE_TODAY;
  if (process.env.APP_ENV === "test" && fake && /^\d{4}-\d{2}-\d{2}$/.test(fake)) return fake;
  return kstDateString();
}
