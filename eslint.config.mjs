import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: ["lib/generated/**", ".next/**", "**/coverage/**", "playwright-report/**", "test-results/**"] },
  {
    // 규칙 엔진은 순수 함수: DB·네트워크·앱 코드 import 금지 (ADR-002)
    files: ["packages/rules/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["@/*", "next/*", "@prisma/*", "pg", "node:*"] }],
    },
  },
];

export default config;
