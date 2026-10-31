/**
 * 배포 시작 시 실행(멱등): 기본 구조 + 초기 관리자 보장.
 * SEED_DEMO=true 면 '처음 한 번만' 데모 데이터(가상 회원·연락망·사업 2개·회의록 2건)를 넣는다 —
 * 다시 시작해도 사용자가 고친 내용을 지우지 않는다. 운영(production)에서는 데모를 넣지 않는다.
 */
import { config } from "dotenv";
config({ path: ".env.local", override: false, quiet: true });
config({ path: ".env", override: false, quiet: true });

const { prisma } = await import("../lib/db");
const { ensureBaseSetup, ensureInitialAdmin } = await import("../lib/setup/bootstrap");
const { seedDemo, seedDemoContent, replaceDemoTemplateTasks } = await import("../lib/setup/demo");
const { todayKst } = await import("../lib/clock");

try {
  const term = await ensureBaseSetup(prisma);
  const r = await ensureInitialAdmin(prisma, process.env.INITIAL_ADMIN_EMAIL, process.env.INITIAL_ADMIN_PASSWORD);
  console.log(r.created ? "초기 관리자 계정을 만들었습니다." : `초기 관리자: ${r.reason}`);
  if (process.env.SEED_DEMO === "true" && process.env.APP_ENV !== "production") {
    const marker = await prisma.setting.findUnique({ where: { term_id_key: { term_id: term.id, key: "DEMO_SEEDED" } } });
    if (!marker) {
      const d = await seedDemo(prisma, process.env.SEED_DEMO_PASSWORD || undefined);
      const c = await seedDemoContent(prisma, todayKst());
      await prisma.setting.create({ data: { term_id: term.id, key: "DEMO_SEEDED", value: true } });
      console.log(`데모 데이터: 회원 ${d.users}명(로그인 ${d.loginEnabled ? "가능" : "불가 — SEED_DEMO_PASSWORD 미설정"}), 연락처 ${d.contacts}건, 사업·회의록 ${c.created ? "생성" : "건너뜀"}`);
    }
  }
  // 예전 데모 데이터: 표준 업무 자동 생성분을 예시 업무로 교체(한 번만, 손대지 않은 것만)
  const rd = await replaceDemoTemplateTasks(prisma);
  if (rd.replaced) console.log(`데모 사업의 자동 표준 업무 ${rd.replaced}건을 예시 업무로 바꿨습니다.`);
} finally {
  await prisma.$disconnect();
}
