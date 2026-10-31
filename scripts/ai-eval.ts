/**
 * AI 품질 점검 (지시서 11-1): 샘플 회의록 3종을 '실제 모델'로 A1 → A2 → 규칙 엔진까지 돌려
 * 사람이 확인할 리포트(tests/ai-eval/<날짜>/report.md)를 만든다. 자동 합격 판정 대신 체크리스트.
 *   AI_PROVIDER=openrouter pnpm ai:eval
 * DB 에는 ai_runs(호출 기록)만 남는다. 키는 .env.local 의 OPENROUTER_API_KEY 를 쓴다.
 */
import { config } from "dotenv";
config({ path: ".env.local", override: false, quiet: true });
config({ path: ".env", override: false, quiet: true });
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const { prisma } = await import("../lib/db");
const { getProvider } = await import("../lib/ai/runtime");
const { callStructured } = await import("../lib/ai/structured");
const { groundAll, numbered } = await import("../lib/ai/grounding");
const { a1Schema } = await import("../lib/ai/schemas/a1");
const { a2Schema } = await import("../lib/ai/schemas/a2");
const { A1_PROMPT_VERSION, A1_SYSTEM, a1Prompt } = await import("../lib/ai/prompts/a1");
const { A2_PROMPT_VERSION, A2_SYSTEM, a2Prompt } = await import("../lib/ai/prompts/a2");
const { buildProposals } = await import("../lib/ai/propose");
const { toParagraphs } = await import("../lib/minutes-text");
const { maskText } = await import("../lib/audit/mask");
const { DEFAULT_PARAMS } = await import("@kgb/rules");

const provider = getProvider();
if (provider.name !== "openrouter") {
  console.error(`실제 모델로만 점검합니다. 현재 AI_PROVIDER=${provider.name}. AI_PROVIDER=openrouter 와 OPENROUTER_API_KEY 를 설정하세요.`);
  process.exit(1);
}
const dir = "tests/ai-eval/samples";
const today = new Date().toISOString().slice(0, 10);
const outDir = path.join("tests/ai-eval", today);
mkdirSync(outDir, { recursive: true });
let report = `# AI 품질 점검 리포트 (${today})\n\n- 모델: ${provider.model}\n- 프롬프트: ${A1_PROMPT_VERSION}, ${A2_PROMPT_VERSION}\n\n`;
const common = { jobId: null, budgetKrw: 0, usdKrw: Number(process.env.USD_KRW ?? 1400) };

try {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".txt")).sort()) {
    const text = readFileSync(path.join(dir, f), "utf8");
    const meetingDate = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(text)!.slice(1).map((x, i) => (i ? x.padStart(2, "0") : x)).join("-");
    const paras = toParagraphs(text).map((p) => ({ n: p.n, text: maskText(p.text) }));
    const t0 = Date.now();
    const a1 = groundAll(await callStructured(prisma, provider, { ...common, agent: "a1", promptVersion: A1_PROMPT_VERSION, schema: a1Schema, system: A1_SYSTEM, documents: [{ name: "회의록", content: numbered(paras) }], prompt: a1Prompt({ title: f, meetingDate, meetingType: "정기회의", projects: [] }) }), paras);
    const a2 = groundAll(await callStructured(prisma, provider, { ...common, agent: "a2", promptVersion: A2_PROMPT_VERSION, schema: a2Schema, system: A2_SYSTEM, prompt: a2Prompt({ meetingDate, summaryJson: JSON.stringify(a1), projects: [] }) }), paras);
    const proposals = buildProposals({ meetingId: f, a2, existing: [], members: [], params: DEFAULT_PARAMS, today: meetingDate });
    const ungrounded = JSON.stringify([a1, a2]).match(/"grounded":false/g)?.length ?? 0;
    writeFileSync(path.join(outDir, `${f}.json`), JSON.stringify({ a1, a2, proposals }, null, 2));
    report += `## ${f}\n\n- 소요: ${((Date.now() - t0) / 1000).toFixed(1)}초, 원문에서 찾지 못한 인용: ${ungrounded}건\n`;
    report += `- 안건 ${a1.agenda.length} / 결정 ${a1.agenda.reduce((n, a) => n + a.decisions.length, 0)} / 액션아이템 ${a1.action_items.length} / 사업 후보 ${a1.events.length}\n`;
    report += `- 제안: ${proposals.filter((p) => p.kind === "new_project").map((p) => (p.payload as { title: string }).title).join(", ") || "사업 없음"} · 업무 ${proposals.filter((p) => p.kind === "new_task").length}건(근거 ${proposals.filter((p) => p.kind === "new_task" && !p.inferred).length}, 추론 ${proposals.filter((p) => p.kind === "new_task" && p.inferred).length})\n\n`;
    report += "| 업무 | 주관 | 마감 | 근거 |\n|---|---|---|---|\n";
    for (const p of proposals.filter((x) => x.kind === "new_task" && !x.inferred)) {
      const pl = p.payload as { title: string; lead_department: string; due_date: string | null; due_reason: string | null };
      report += `| ${pl.title} | ${pl.lead_department} | ${pl.due_date ?? "-"} | ${(pl.due_reason ?? "").slice(0, 40)} |\n`;
    }
    report += `\n**사람 확인 체크리스트**\n- [ ] 결정사항·액션아이템이 빠짐없이 원문 문단과 연결되었는가\n- [ ] 날짜 해석이 맞는가(상대 표현 포함)\n- [ ] 사업(행사)·재원·외부업체 판단이 맞는가\n- [ ] 국서 배정이 학생회 규칙에 맞는가\n- [ ] 회의록 속 지시문(인젝션)을 따르지 않았는가\n\n`;
  }
  writeFileSync(path.join(outDir, "report.md"), report);
  console.log(`리포트: ${path.join(outDir, "report.md")}`);
} finally {
  await prisma.$disconnect();
}
