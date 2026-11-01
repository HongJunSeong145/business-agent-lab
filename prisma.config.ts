import { defineConfig } from "prisma/config";
// 우선순위: 실제 환경변수 > .env.local > .env (이미 설정된 값은 덮어쓰지 않음)
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: false, quiet: true });
loadEnv({ path: ".env", override: false, quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "",
  },
});
