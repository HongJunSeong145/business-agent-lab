import { z } from "zod";
import type { Db } from "@/lib/db";
import { assertCan, type Actor } from "@/lib/auth/can";
import { writeAudit } from "@/lib/audit/log";
import { todayKst } from "@/lib/clock";
import { dateColumnToString } from "@/lib/utils";
import { loadRuleParams } from "@/lib/rule-params";
import { getNumberSetting } from "@/lib/settings";
import { detectAlerts, rosterRequired, summarizeAlerts, type Alert, type MonitorProject, type MonitorTask } from "@kgb/rules";
import type { AiProvider } from "@/lib/ai/provider";
import { callStructured } from "@/lib/ai/structured";
import { COUNCIL_RULES } from "@/lib/ai/prompts/common";

/**
 * A7 사업 진행 모니터링 (6-2 A7, 5-6, T20).
 *  - 매일 09:00 KST(pg-boss 일정) 또는 '지금 점검' 버튼으로 실행
 *  - 탐지는 코드(@kgb/rules detectAlerts), 사무국 노티스 문장만 LLM(선택 — 실패·예산 초과·AI 없음이면 코드 문장)
 *  - 같은 알림은 같은 등급이면 하루 1번만(dedupe_key = 종류:대상:등급:날짜), 등급이 오르면 새로 알림
 *  - 월요일(또는 weekly=true)에는 사무국장·회장에게 주간 요약
 */
export const A7_PROMPT_VERSION = "a7-v1";
const KST = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

export async function collectMonitorInput(db: Db, termId: string) {
  const tasks = await db.task.findMany({
    where: { deleted_at: null, departments: { some: { role: "lead", department: { term_id: termId } } } },
    include: { progress_history: { orderBy: { created_at: "desc" }, take: 1, select: { created_at: true } }, deliverables: { select: { versions: { orderBy: { created_at: "desc" }, take: 1, select: { created_at: true } } } } },
  });
  const logs = await db.activityLog.findMany({
    where: { entity_type: "task", entity_id: { in: tasks.map((t) => t.id) }, action: { in: ["task.auto_status", "task.update"] } },
    orderBy: { created_at: "desc" },
    select: { entity_id: true, created_at: true, diff: true },
  });
  const params = await loadRuleParams(db, termId);
  const projects = await db.project.findMany({
    where: { term_id: termId, deleted_at: null },
    include: { funding_sources: true, evidence_requirements: { include: { _count: { select: { items: { where: { deleted_at: null } } } } } }, purchase_items: { where: { status: "purchased" }, include: { _count: { select: { evidence_items: { where: { deleted_at: null } } } } } } },
  });
  const mTasks: MonitorTask[] = tasks.map((t) => {
    const mine = logs.filter((l) => l.entity_id === t.id);
    const statusChange = mine.find((l) => (l.diff as { after?: unknown } | null)?.after !== undefined);
    const blockedLog = mine.find((l) => (l.diff as { after?: string } | null)?.after === "blocked");
    const times = [t.created_at, t.progress_history[0]?.created_at, statusChange?.created_at, ...t.deliverables.map((d) => d.versions[0]?.created_at)].filter(Boolean) as Date[];
    return {
      id: t.id, title: t.title, project_id: t.project_id, status: t.status, is_completed: t.is_completed,
      due: t.due_date ? dateColumnToString(t.due_date) : null, due_feasible: t.due_feasible, template_key: t.template_key,
      last_change: KST(new Date(Math.max(...times.map((d) => d.getTime())))),
      blocked_since: t.status === "blocked" ? KST(blockedLog?.created_at ?? t.created_at) : null,
    };
  });
  const mProjects: MonitorProject[] = projects.map((p) => ({
    id: p.id, title: p.title, status: p.status,
    event_end: p.event_end ? dateColumnToString(p.event_end) : p.event_start ? dateColumnToString(p.event_start) : null,
    student_fee: p.funding_sources.some((f) => f.source === "student_fee"),
    roster_required: rosterRequired(p.expected_beneficiaries, params.ROSTER_THRESHOLD),
    evidence: p.evidence_requirements.map((r) => ({ type: r.type, count: r._count.items })),
    purchased: p.purchase_items.map((i) => ({ id: i.id, name: i.name, purchased_on: KST(i.purchased_at ?? i.updated_at), has_receipt: i._count.evidence_items > 0 })),
  }));
  return { tasks: mTasks, projects: mProjects, params, raw: { tasks, projects } };
}

const a7Schema = z.object({ summary: z.string().min(1).max(800), top_actions: z.array(z.string().max(200)).max(5) });

export async function runMonitor(db: Db, termId: string, opts: { provider?: AiProvider | null; today?: string; weekly?: boolean } = {}) {
  const today = opts.today ?? todayKst();
  const input = await collectMonitorInput(db, termId);
  const alerts = detectAlerts({ today, tasks: input.tasks, projects: input.projects, stallDays: await getNumberSetting(db, termId, "STALL_DAYS", 3), photoGraceDays: input.params.EVIDENCE_PHOTO_GRACE_DAYS });

  const members = await db.membership.findMany({ where: { term_id: termId, user: { status: "active" } }, include: { department: { select: { id: true, code: true } } } });
  const heads = (code: string) => members.filter((m) => m.department?.code === code && (m.role === "head" || m.role === "admin")).map((m) => m.user_id);
  const finance = members.filter((m) => m.department?.code === "finance").map((m) => m.user_id);
  const presidents = members.filter((m) => m.role === "president").map((m) => m.user_id);
  const taskById = new Map(input.raw.tasks.map((t) => [t.id, t]));
  const assignees = await db.taskAssignee.findMany({ where: { task_id: { in: alerts.flatMap((a) => (a.task_id ? [a.task_id] : [])) } } });
  const leads = await db.taskDepartment.findMany({ where: { task_id: { in: alerts.flatMap((a) => (a.task_id ? [a.task_id] : [])) }, role: "lead" }, include: { department: { select: { code: true } } } });
  const purchasers = new Map(input.raw.projects.flatMap((p) => p.purchase_items.map((i) => [i.id, i.purchased_by] as const)));

  const recipients = (a: Alert): string[] => {
    if (a.audience === "president_planning") return [...presidents, ...heads("planning")];
    if (a.audience === "finance") return [...finance, ...(purchasers.get(a.entity) ? [purchasers.get(a.entity)!] : [])];
    const own = assignees.filter((x) => x.task_id === a.task_id).map((x) => x.user_id);
    if (own.length) return own;
    const code = leads.find((l) => l.task_id === a.task_id)?.department.code;
    return code ? heads(code) : presidents;
  };
  const deptOf = (a: Alert) => (a.audience === "finance" ? members.find((m) => m.department?.code === "finance")?.department?.id ?? null : null);
  const linkOf = (a: Alert) => {
    if (a.task_id) {
      const code = leads.find((l) => l.task_id === a.task_id)?.department.code ?? "planning";
      return `/departments/${code}?task=${a.task_id}`;
    }
    return a.project_id ? `/projects/${a.project_id}#finance` : "/finance";
  };

  const rows = alerts.flatMap((a) =>
    [...new Set(recipients(a))].map((user_id) => ({
      user_id, department_id: deptOf(a), type: `monitor_${a.kind}`, title: a.title, severity: a.severity, link: linkOf(a),
      body: a.task_id && taskById.get(a.task_id)?.project_id ? input.raw.projects.find((p) => p.id === taskById.get(a.task_id!)!.project_id)?.title ?? null : null,
      dedupe_key: `mon:${a.kind}:${a.entity}:${a.severity}:${today}`,
    })),
  );
  const created = rows.length ? (await db.notification.createMany({ data: rows, skipDuplicates: true })).count : 0;

  // 사무국 노티스: 사무국장 + 회장 (하루 1번)
  const s = summarizeAlerts(alerts);
  const weekly = opts.weekly ?? new Date(`${today}T00:00:00Z`).getUTCDay() === 1;
  let sentence = `오늘 점검: 초과 ${s.overdue} · 임박 ${s.upcoming} · 진척 없음/장기 차단 ${s.stalled} · 증빙 누락 ${s.evidence} · 불가 일정 ${s.infeasible}건 (긴급 ${s.critical}건)`;
  let usedAi = false;
  if (opts.provider?.available && alerts.length) {
    try {
      const out = await callStructured(db, opts.provider, {
        agent: "a7", promptVersion: A7_PROMPT_VERSION, schema: a7Schema, jobId: null,
        budgetKrw: await getNumberSetting(db, termId, "AI_DAILY_BUDGET_KRW", 30000), usdKrw: Number(process.env.USD_KRW ?? 1400), maxTokens: 2000,
        system: `너는 학생회 사무국의 진행 점검 비서다. 주어진 점검 결과만으로 사무국장이 오늘 챙길 일을 한국어로 짧게 정리한다. 없는 사실을 만들지 않는다.${COUNCIL_RULES}`,
        documents: [{ name: "점검 결과", content: alerts.slice(0, 60).map((a) => `- [${a.severity}] ${a.title}`).join("\n") }],
        prompt: `${weekly ? "이번 주 요약" : "오늘 요약"}을 summary(3문장 이내)와 top_actions(가장 급한 일 최대 5개)로 제출하라.`,
        mockContext: { summary: s },
      });
      sentence = `${out.summary}${out.top_actions.length ? `\n- ${out.top_actions.join("\n- ")}` : ""}`;
      usedAi = true;
    } catch {
      /* 예산 초과·AI 오류 → 코드 문장 그대로 */
    }
  }
  const notice = [...new Set([...heads("secretariat"), ...presidents])];
  const noticeRows = notice.map((user_id) => ({
    user_id, type: weekly ? "monitor_weekly" : "monitor_daily", title: weekly ? `[주간 요약] 사업 진행 점검 ${today}` : `[사무국 노티스] 사업 진행 점검 ${today}`,
    body: sentence, severity: s.critical ? "warn" : "info", link: "/finance#monitor", dedupe_key: `mon:${weekly ? "weekly" : "daily"}:${today}`,
  }));
  const noticeCount = noticeRows.length ? (await db.notification.createMany({ data: noticeRows, skipDuplicates: true })).count : 0;
  await writeAudit(db, { actorId: null, actorKind: "system", action: "monitor.run", entityType: "term", entityId: termId, diff: { today, alerts: alerts.length, created, notices: noticeCount, weekly, usedAi, summary: s } });
  return { today, alerts, summary: s, created, notices: noticeCount, sentence, usedAi };
}

/** '지금 점검' 버튼 (회장·국장) */
export async function runMonitorNow(db: Db, actor: Actor & { termId: string }, provider: AiProvider | null) {
  assertCan(actor, { type: "monitor.run" });
  return runMonitor(db, actor.termId, { provider });
}

/** 최근 점검 결과(재정 페이지 표시용) */
export async function lastMonitorRun(db: Db, termId: string) {
  return db.activityLog.findFirst({ where: { action: "monitor.run", entity_type: "term", entity_id: termId }, orderBy: { created_at: "desc" } });
}
