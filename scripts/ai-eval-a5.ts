/**
 * A5 레퍼런스·예시안 실제 모델 점검 (Phase 7 완료 기준 T19 + 기획안 결재 연동).
 *   AI_PROVIDER=anthropic pnpm ai:eval:a5
 * 테스트 DB(kgb_test)를 비우고 가상 사업·기획안·업무를 만들어 실제 웹 검색 + 예시안 제작을 확인하고 리포트를 남긴다.
 */
import { config } from "dotenv";
config({ path: ".env.local", override: false, quiet: true });
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://kgb:kgb_dev_pw@localhost:5432/kgb_test";
process.env.APP_ENV = "test";

const { prisma } = await import("../lib/db");
const { resetAllTables } = await import("../lib/setup/reset");
const { ensureBaseSetup } = await import("../lib/setup/bootstrap");
const { createProject } = await import("../lib/services/projects");
const { applyStandardTemplate } = await import("../lib/services/schedule");
const { updateTask } = await import("../lib/services/tasks");
const { savePlanVersion, approvePlan } = await import("../lib/services/plans");
const { requestReferences, listReferences } = await import("../lib/services/references");
const { runReferenceJob } = await import("../lib/ai/reference");
const { getProvider } = await import("../lib/ai/runtime");
const { A5_PROMPT_VERSION } = await import("../lib/ai/prompts/a5");

const provider = getProvider();
if (provider.name !== "anthropic") {
  console.error(`웹 검색 포함 실제 모델 점검은 AI_PROVIDER=anthropic 에서만 합니다. 현재 ${provider.name}.`);
  process.exit(1);
}
class MemoryStorage {
  readonly driver = "local" as const;
  files = new Map<string, Uint8Array>();
  async put(k: string, d: Uint8Array) { this.files.set(k, d); }
  async get(k: string) { return this.files.get(k) ?? null; }
  async delete(k: string) { this.files.delete(k); }
}
const today = new Date().toISOString().slice(0, 10);
const outDir = path.join("tests/ai-eval", today);
mkdirSync(outDir, { recursive: true });
const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
let report = `# A5 레퍼런스·예시안 — 실제 모델 점검 (${today})\n\n- 모델: ${provider.model} (웹 검색: web_search 서버 도구)\n- 프롬프트: ${A5_PROMPT_VERSION}\n\n`;

try {
  await resetAllTables(prisma);
  const term = await ensureBaseSetup(prisma, new Date(`${today}T00:00:00Z`));
  const dept = Object.fromEntries((await prisma.department.findMany({ where: { term_id: term.id } })).map((d) => [d.code, d.id]));
  const mk = async (role: "president" | "member", code?: string) => {
    const u = await prisma.user.create({ data: { email: `${role}-${code ?? "x"}@eval.invalid`, display_name: `${role}-${code ?? ""}`, status: "active" } });
    await prisma.membership.create({ data: { user_id: u.id, term_id: term.id, role, department_id: code ? dept[code] : null } });
    return { userId: u.id, role, departmentId: code ? dept[code]! : null, departmentCode: code ?? null, termId: term.id };
  };
  const pres = await mk("president");
  const planner = await mk("member", "planning");
  const promo = await mk("member", "promotion");
  const sec = await mk("member", "secretariat");

  const p = await createProject(prisma, pres, { title: "기말고사 응원 간식 나눔", event_start: "2026-12-09", venue: "데모관 1층 로비", expected_beneficiaries: 80, host: "제9대 데모단과대학 학생회", organizer: "기획국·집행국", funding: [{ source: "student_fee", amount_planned: 400000 }] });
  await applyStandardTemplate(prisma, pres, p.id, undefined, today);
  const tasks = await prisma.task.findMany({ where: { project_id: p.id } });
  const byKey = (k: string) => tasks.find((t) => t.template_key === k)!;
  await savePlanVersion(prisma, new MemoryStorage(), planner, p.id, {
    fields: {
      title: "기말고사 응원 간식 나눔", datetime: "2026-12-09(수) 12:00 ~ 소진 시", venue: "데모관 1층 로비", budget: 400000, host: "제9대 데모단과대학 학생회", organizer: "기획국·집행국",
      purpose: "기말고사 기간 학우들의 학업 스트레스를 덜고 학생회 활동을 알린다.", content: "학생증 확인 후 간식 꾸러미 1인 1개 배부(선착순 80명), 수혜자 명단 작성",
      timetable: [{ time: "11:30", item: "부스 설치" }, { time: "12:00", item: "배부 시작" }], budget_scenarios: [],
    },
  });
  const ap = await approvePlan(prisma, pres, p.id);
  const opsStatus = (await prisma.task.findUniqueOrThrow({ where: { id: byKey("OPS_MANUAL").id } })).status;
  check("기획안 결재 → 결재 의존 업무 자동 todo", opsStatus === "todo" && ap.unblocked.length > 0, `해제 ${ap.unblocked.length}개: ${ap.unblocked.map((u) => u.title).join(", ")}`);

  const cases = [
    { label: "홍보국 — 홍보물 제작(지시 포함)", task: byKey("PRO_MAKE"), actor: promo, instruction: "인스타그램 카드뉴스 5장 이내, 20대 대학생 감성으로" },
    { label: "사무국 — 제휴 요청서·이메일", task: byKey("SEC_PROPOSAL"), actor: sec, instruction: "학교 근처 카페·편의점 프랜차이즈에 간식 협찬 요청" },
  ];
  const browser = await chromium.launch();
  for (const c of cases) {
    await updateTask(prisma, pres, c.task.id, { assignee_ids: [c.actor.userId] });
    const { aiJobId, requestId } = await requestReferences(prisma, c.actor, c.task.id, { instruction: c.instruction, usePastWork: false }, true);
    const t0 = Date.now();
    const r = await runReferenceJob(prisma, provider, aiJobId);
    const sec_ = ((Date.now() - t0) / 1000).toFixed(1);
    const view = await listReferences(prisma, c.actor, c.task.id, true);
    const req = view.requests.find((x) => x.id === requestId)!;
    const refs = view.items.filter((i) => i.origin === "ai_search");
    const ex = view.items.filter((i) => i.origin === "ai_generated");
    const jobErr = (await prisma.aiJob.findUnique({ where: { id: aiJobId } }))?.error;
    if (jobErr) console.error(`[${c.label}] 작업 오류: ${jobErr}`);
    report += `## ${c.label} (${sec_}초)\n\n- 지시: ${c.instruction}\n- 결과: ${r.outcome}${jobErr ? ` (오류: ${jobErr})` : ""}, ${req.snapshot?.searchNote ?? ""}\n- 사용한 기획안: ${req.snapshot?.plan ? `v${req.snapshot.plan.versionNo} ${req.snapshot.plan.isDraft ? "초안" : "결재본"}` : "없음"}\n- 메모: ${(req.snapshot as { notes?: string } | null)?.notes ?? ""}\n\n### 검색 레퍼런스 ${refs.length}건\n\n`;
    for (const i of refs) report += `- [${i.title}](${i.url})\n  - ${i.summary}\n  - 벤치마킹: ${i.points.join(" / ")}\n`;
    report += `\n### 예시안 ${ex.length}건\n\n`;
    for (const i of ex) {
      report += `#### ${i.title} (${i.summary}, ${i.format}${i.needsReview ? ", 발송 전 검토 필요" : ""})\n\n`;
      if (i.format === "svg") {
        const page = await browser.newPage({ viewport: { width: 600, height: 850 } });
        await page.setContent(`<html><body style="margin:0">${i.content}</body></html>`);
        const file = `a5-${c.task.template_key}-mockup.png`;
        writeFileSync(path.join(outDir, file), await page.screenshot({ type: "png" }));
        await page.close();
        report += `![목업](${file})\n\n`;
      } else report += `\`\`\`${i.format === "html" ? "html" : "markdown"}\n${i.content}\n\`\`\`\n\n`;
    }
    check(`T19 ${c.label}: 성공·출처 링크 있는 레퍼런스`, r.outcome === "succeeded" && refs.length > 0 && refs.every((i) => /^https?:\/\//.test(i.url ?? "")), `${r.outcome}, 레퍼런스 ${refs.length}건, 검색 실패=${r.searchFailed}`);
    check(`T19 ${c.label}: 사용한 기획안 버전 기록`, req.snapshot?.plan?.versionNo === 1 && req.snapshot.plan.isDraft === false, JSON.stringify(req.snapshot?.plan));
    if (c.task.template_key === "PRO_MAKE") check("홍보국 형식: 카드뉴스 문구 + SVG 목업", ex.some((i) => i.format === "svg") && ex.some((i) => /카드뉴스/.test(i.title + (i.summary ?? ""))), ex.map((i) => `${i.title}(${i.format})`).join(", "));
    if (c.task.template_key === "SEC_PROPOSAL") check("사무국 형식: 요청서 구성안 + 이메일 문안(발송 전 검토 필요)", ex.some((i) => i.needsReview) && ex.length >= 2, ex.map((i) => `${i.title}${i.needsReview ? "[검토]" : ""}`).join(", "));
    check(`${c.label}: 개인 연락처 없음`, !ex.some((i) => /01[016789]-?\d{3,4}-?\d{4}/.test(i.content ?? "")), "휴대전화 번호 패턴 검사");
  }
  await browser.close();
  const runs = await prisma.aiRun.findMany({ where: { agent: { in: ["a5", "a5_search"] } } });
  const cost = runs.reduce((n, r) => n + Number(r.cost_estimate_krw ?? 0), 0);
  report += `## 호출 기록\n\n- 검색 ${runs.filter((r) => r.agent === "a5_search").length}회 + 정리·예시안 ${runs.filter((r) => r.agent === "a5").length}회, 형식 통과 ${runs.filter((r) => r.output_valid).length}/${runs.length}, 추정 비용 합계 ${cost.toFixed(0)}원 (의뢰 1건 평균 ${(cost / cases.length).toFixed(0)}원)\n\n`;
} finally {
  report += `## 자동 확인\n\n| 항목 | 결과 | 값 |\n|---|---|---|\n${checks.map((c) => `| ${c.name} | ${c.ok ? "✅" : "❌"} | ${c.detail.replace(/\|/g, "/")} |`).join("\n")}\n\n`;
  report += `**사람 확인 체크리스트**\n- [ ] 레퍼런스가 실제로 이 업무에 도움이 되는 사례인가(링크 열어 확인)\n- [ ] 예시안이 기획안의 일시·장소·예산을 정확히 썼는가\n- [ ] 외부 저작물 원문을 통째로 옮기지 않았는가\n- [ ] 이메일·요청서 문안을 그대로 보내도 될 수준인가(발송 전 검토)\n`;
  writeFileSync(path.join(outDir, "a5-report.md"), report);
  console.log(`리포트: ${path.join(outDir, "a5-report.md")}`);
  for (const c of checks) console.log(`${c.ok ? "✅" : "❌"} ${c.name} — ${c.detail}`);
  await resetAllTables(prisma);
  await prisma.$disconnect();
}
process.exit(checks.every((c) => c.ok) ? 0 : 1);
