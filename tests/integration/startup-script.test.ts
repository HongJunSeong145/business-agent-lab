import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * 배포 시작 명령(db:migrate → admin:ensure → start)의 admin:ensure 를 테스트 별칭 없이 실제로 실행한다.
 * (2026-11-01 배포 실패: 시작 스크립트가 서버 전용 모듈을 불러와 멈춘 문제 재발 방지 — vitest 별칭으로는 잡히지 않음)
 */
describe("배포 시작 스크립트", () => {
  it("scripts/ensure-admin.ts 가 서버 밖(tsx)에서 오류 없이 끝난다", () => {
    const out = execFileSync("pnpm", ["exec", "tsx", "scripts/ensure-admin.ts"], {
      env: { ...process.env, SEED_DEMO: "true", APP_ENV: "test", NODE_OPTIONS: "" },
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(out).toMatch(/초기 관리자/);
  }, 150_000);
});
