// 단위·통합 테스트 환경: 테스트 전용 DB 고정, AI 는 mock
process.env.APP_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://kgb:kgb_dev_pw@localhost:5432/kgb_test";
process.env.AUTH_SECRET ??= "unit-test-secret-0123456789abcdef-0123456789";
process.env.AI_PROVIDER = "mock";
