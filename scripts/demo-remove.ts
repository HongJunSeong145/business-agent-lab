/**
 * 데모 데이터 제거 (운영 전환 체크리스트, docs/OPERATIONS.md): is_demo 로 표시된 사업·회의록·인적사항·연락처·데모 계정을 지운다.
 *   pnpm demo:remove -- --yes
 */
import { config } from "dotenv";
config({ path: ".env.local", override: false, quiet: true });

if (!process.argv.includes("--yes")) {
  console.error("데모 데이터(가상 회원·사업·회의록·연락처)를 모두 지웁니다. 계속하려면 --yes 를 붙이세요.");
  process.exit(1);
}
const { prisma } = await import("../lib/db");
try {
  const r = await prisma.$transaction(async (tx) => {
    const projects = await tx.project.findMany({ where: { is_demo: true }, select: { id: true } });
    const tasks = await tx.task.deleteMany({ where: { project_id: { in: projects.map((p) => p.id) } } });
    const p = await tx.project.deleteMany({ where: { is_demo: true } });
    const m = await tx.meeting.deleteMany({ where: { is_demo: true } });
    const prof = await tx.memberProfile.deleteMany({ where: { is_demo: true } });
    const c = await tx.contactRow.deleteMany({ where: { is_demo: true } });
    await tx.membership.deleteMany({ where: { is_demo: true } });
    const u = await tx.user.deleteMany({ where: { is_demo: true } });
    await tx.setting.deleteMany({ where: { key: "DEMO_SEEDED" } });
    return { projects: p.count, tasks: tasks.count, meetings: m.count, profiles: prof.count, contacts: c.count, users: u.count };
  });
  console.log(`데모 데이터 제거: ${JSON.stringify(r)}`);
} finally {
  await prisma.$disconnect();
}
