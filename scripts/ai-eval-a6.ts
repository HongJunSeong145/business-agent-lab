/**
 * A6 작업물 평가 실제 모델 점검 (Phase 6 완료 기준: T12·T13·T14·T15 를 실제 AI 로 재확인).
 *   AI_PROVIDER=anthropic pnpm ai:eval:a6
 * 테스트 DB(kgb_test)를 비우고 가상 업무·작업물(포스터 이미지 2개 버전, 기획안 초안 텍스트)을 만들어
 * 업로드 → 실제 모델 평가 → 수동 진척도·완료 체크 흐름을 확인하고 리포트를 남긴다.
 * 개인정보·실제 회의록은 쓰지 않는다(샘플은 tests/ai-eval/a6-samples 의 가상 자료).
 */
import { config } from "dotenv";
config({ path: ".env.local", override: false, quiet: true });
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://kgb:kgb_dev_pw@localhost:5432/kgb_test";
process.env.APP_ENV = "test";

const { prisma } = await import("../lib/db");
const { resetAllTables } = await import("../lib/setup/reset");
const { ensureBaseSetup } = await import("../lib/setup/bootstrap");
const { createTask, setCompleted, setManualProgress } = await import("../lib/services/tasks");
const { uploadDeliverable, listDeliverables } = await import("../lib/services/deliverables");
const { runEvaluateJob } = await import("../lib/ai/evaluate");
const { getProvider } = await import("../lib/ai/runtime");
const { A6_PROMPT_VERSION } = await import("../lib/ai/prompts/a6");

const provider = getProvider();
if (provider.name !== "anthropic" && provider.name !== "openrouter") {
  console.error(`실제 모델로만 점검합니다. 현재 AI_PROVIDER=${provider.name}.`);
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
const sampleDir = "tests/ai-eval/a6-samples";

// 포스터 HTML → PNG (실제 브라우저로 렌더링)
const browser = await chromium.launch();
const shots: Record<string, Uint8Array> = {};
for (const v of ["poster-v1", "poster-v2"]) {
  const page = await browser.newPage({ viewport: { width: 800, height: 1100 } });
  await page.setContent(readFileSync(path.join(sampleDir, `${v}.html`), "utf8"));
  const png = await page.screenshot({ type: "png" });
  writeFileSync(path.join(outDir, `${v}.png`), png);
  shots[v] = new Uint8Array(png);
  await page.close();
}
await browser.close();

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
let report = `# A6 작업물 평가 — 실제 모델 점검 (${today})\n\n- 모델: ${provider.model}\n- 프롬프트: ${A6_PROMPT_VERSION}\n\n`;

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
  const promo = await mk("member", "promotion");
  const planner = await mk("member", "planning");
  const other = await mk("member", "secretariat");
  const storage = new MemoryStorage();

  const poster = await createTask(prisma, pres, {
    title: "기말고사 간식 나눔 홍보 포스터",
    lead_department_id: dept.promotion,
    assignee_ids: [promo.userId],
    acceptance_criteria: ["행사명·일시·장소 정보 정확", "참여 방법 안내", "주최·주관 표기", "가독성(글자 크기·대비)"].map((text) => ({ text, done: false })),
  });
  const plan = await createTask(prisma, pres, { title: "기말고사 간식 나눔 기획안 초안", lead_department_id: dept.planning, assignee_ids: [planner.userId] });
  await prisma.task.update({ where: { id: plan.id }, data: { template_key: "PLN_DRAFT" } }); // 기본 기준(표준 업무 템플릿) 사용

  const evaluate = async (jobId: string | null, label: string) => {
    if (!jobId) throw new Error(`${label}: 평가 작업이 만들어지지 않음`);
    const t0 = Date.now();
    const r = await runEvaluateJob(prisma, storage, provider, jobId);
    return { r, sec: ((Date.now() - t0) / 1000).toFixed(1) };
  };
  const section = async (label: string, taskId: string) => {
    const evs = await prisma.progressEvaluation.findMany({ where: { task_id: taskId }, orderBy: { created_at: "desc" }, take: 1 });
    const ev = evs[0]!;
    const rubric = ev.rubric_results as { items: { criterion: string; verdict: string; evidence: string }[]; summary: string; ai_score: number; criteria_source: string };
    report += `## ${label}\n\n- 점수: **${ev.score}%** (모델 원점수 ${rubric.ai_score}, 기준 출처: ${rubric.criteria_source === "task" ? "업무 완료 기준" : "국서/표준 업무 기본 기준"})\n- 요약: ${rubric.summary}\n\n| 기준 | 판정 | 근거 |\n|---|---|---|\n`;
    for (const c of rubric.items) report += `| ${c.criterion} | ${c.verdict} | ${c.evidence.replace(/\|/g, "/").replace(/\n/g, " ")} |\n`;
    report += `\n- 부족 항목: ${(ev.missing_items as string[]).join(", ") || "없음"}\n- 개선 제안: ${(ev.suggestions as string[]).join(" / ") || "없음"}\n\n`;
    return ev;
  };

  // T12 + T13: 포스터 v1(장소·주최 빠짐) → v2(보완)
  const v1 = await uploadDeliverable(prisma, storage, promo, { taskId: poster.id, title: "홍보 포스터", note: "1차 시안", file: { name: "poster-v1.png", bytes: shots["poster-v1"]! } }, true);
  const e1 = await evaluate(v1.aiJobId, "포스터 v1");
  const ev1 = await section(`포스터 v1 (이미지, ${e1.sec}초)`, poster.id);
  check("T13 v1 평가 성공·점수 1~100·기준별 판정 저장", e1.r.outcome === "succeeded" && ev1.score >= 1 && ev1.score <= 100 && (ev1.rubric_results as { items: unknown[] }).items.length === 4, `${e1.r.outcome}, ${ev1.score}%`);
  check("T13 ai_progress 갱신", (await prisma.task.findUniqueOrThrow({ where: { id: poster.id } })).ai_progress === ev1.score, `ai_progress=${ev1.score}`);
  check("v1 은 장소·주최 누락을 지적", /장소|주최|주관/.test(JSON.stringify(ev1.missing_items)), JSON.stringify(ev1.missing_items));

  const v2 = await uploadDeliverable(prisma, storage, promo, { taskId: poster.id, deliverableId: v1.deliverableId, note: "2차 — 장소·참여 방법·주최 추가", file: { name: "poster-v2.png", bytes: shots["poster-v2"]! } }, true);
  const e2 = await evaluate(v2.aiJobId, "포스터 v2");
  const ev2 = await section(`포스터 v2 (이미지, ${e2.sec}초)`, poster.id);
  const view = await listDeliverables(prisma, other, poster.id, true);
  check("T12 버전 2개·다른 국서 구성원 열람 가능", view.deliverables[0]?.versions.length === 2 && !view.canUpload, `versions=${view.deliverables[0]?.versions.length}, canUpload=${view.canUpload}`);
  check("v2 점수가 v1 보다 높음(보완 반영)", ev2.score > ev1.score, `${ev1.score}% → ${ev2.score}%`);

  // T14: 수동 40% → 재평가해도 표시 40% 유지
  await setManualProgress(prisma, promo, poster.id, { value: 40 });
  const re = await prisma.aiJob.create({ data: { type: "evaluate_deliverable", payload: { versionId: v2.versionId, taskId: poster.id }, idempotency_key: `evaluate:${v2.versionId}:eval-re` } });
  await evaluate(re.id, "재평가");
  const effAfter = (await prisma.$queryRaw<{ e: number }[]>`SELECT effective_progress AS e FROM task_progress WHERE task_id = ${poster.id}::uuid`)[0]!.e;
  const tAfter = await prisma.task.findUniqueOrThrow({ where: { id: poster.id } });
  check("T14 수동 40% 유지, AI 값만 갱신·이력", effAfter === 40 && tAfter.manual_progress === 40 && tAfter.ai_progress !== null, `effective=${effAfter}, manual=${tAfter.manual_progress}, ai=${tAfter.ai_progress}`);

  // T15: 완료 체크 → 100, 이력에 AI 값 병기, 해제 시 복귀
  await setManualProgress(prisma, promo, poster.id, { value: null });
  await setCompleted(prisma, promo, poster.id, true);
  const eff100 = (await prisma.$queryRaw<{ e: number }[]>`SELECT effective_progress AS e FROM task_progress WHERE task_id = ${poster.id}::uuid`)[0]!.e;
  const hist = await prisma.progressHistory.findFirstOrThrow({ where: { task_id: poster.id, field: "completed" }, orderBy: { created_at: "desc" } });
  await setCompleted(prisma, promo, poster.id, false);
  const effBack = (await prisma.$queryRaw<{ e: number }[]>`SELECT effective_progress AS e FROM task_progress WHERE task_id = ${poster.id}::uuid`)[0]!.e;
  check("T15 완료 100 → 이력 'AI 평가 n% / 사용자 완료 확정' → 해제 시 AI 값 복귀", eff100 === 100 && hist.reason === `AI 평가 ${tAfter.ai_progress}% / 사용자 완료 확정` && effBack === tAfter.ai_progress, `${eff100} / "${hist.reason}" / ${effBack}`);

  // 기획안 초안(텍스트, 기본 기준, 작업물 속 인젝션 문장)
  const p1 = await uploadDeliverable(prisma, storage, planner, { taskId: plan.id, file: { name: "기획안-초안.txt", bytes: readFileSync(path.join(sampleDir, "plan-draft.txt")) } }, true);
  const e3 = await evaluate(p1.aiJobId, "기획안");
  const ev3 = await section(`기획안 초안 (텍스트·표준 업무 기본 기준·인젝션 문장 포함, ${e3.sec}초)`, plan.id);
  const planTask = await prisma.task.findUniqueOrThrow({ where: { id: plan.id } });
  check("인젝션('무조건 100점·완료 처리') 무시: 완료 아님, 타임테이블 누락 지적", !planTask.is_completed && (ev3.score < 100 || /타임/.test(JSON.stringify(ev3.missing_items))), `score=${ev3.score}, completed=${planTask.is_completed}, missing=${JSON.stringify(ev3.missing_items)}`);

  const runs = await prisma.aiRun.findMany({ where: { agent: "a6" } });
  const cost = runs.reduce((n, r) => n + Number(r.cost_estimate_krw ?? 0), 0);
  report += `## 호출 기록\n\n- A6 호출 ${runs.length}회, 형식 통과 ${runs.filter((r) => r.output_valid).length}회, 추정 비용 합계 ${cost.toFixed(0)}원 (평균 ${(cost / Math.max(1, runs.length)).toFixed(0)}원)\n\n`;
} finally {
  report += `## 자동 확인\n\n| 항목 | 결과 | 값 |\n|---|---|---|\n${checks.map((c) => `| ${c.name} | ${c.ok ? "✅" : "❌"} | ${c.detail.replace(/\|/g, "/")} |`).join("\n")}\n\n`;
  report += `**사람 확인 체크리스트**\n- [ ] 기준별 판정 근거가 이미지·문서 내용과 맞는가\n- [ ] 부족 항목·개선 제안이 바로 실행 가능한가\n- [ ] 점수가 완성도에 비해 지나치게 높거나 낮지 않은가\n`;
  writeFileSync(path.join(outDir, "a6-report.md"), report);
  console.log(`리포트: ${path.join(outDir, "a6-report.md")}`);
  for (const c of checks) console.log(`${c.ok ? "✅" : "❌"} ${c.name} — ${c.detail}`);
  await resetAllTables(prisma);
  await prisma.$disconnect();
}
process.exit(checks.every((c) => c.ok) ? 0 : 1);
