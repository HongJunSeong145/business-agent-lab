/** E2E 공용 상수 — 테스트 DB 전용 값(실제 계정 아님) */
export const E2E = {
  databaseUrl: process.env.TEST_DATABASE_URL ?? "postgresql://kgb:kgb_dev_pw@localhost:5432/kgb_test",
  adminEmail: "admin@e2e.test",
  adminPassword: "e2e-admin-password",
  demoPassword: "e2e-demo-password",
  memberEmail: "planning.member@demo.kgb.invalid",
};
