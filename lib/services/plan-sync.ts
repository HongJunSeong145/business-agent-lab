import type { Db } from "@/lib/db";
import type { Actor } from "@/lib/auth/can";
import { dispatchJob } from "@/lib/jobs/queue";
import { approvePlanFromTask } from "./plans";

/**
 * 기획안 업무 완료(완료 체크·진척도 100%·일괄 완료) 뒤처리: 회장·국장이면 최신 기획안을 결재로 반영하고
 * 결재본 기준 재배정 작업을 보낸다. 화면에 보여 줄 한 줄 안내를 돌려준다.
 */
export async function afterTaskDone(db: Db, actor: Actor & { termId: string }, taskId: string): Promise<string | null> {
  const r = await approvePlanFromTask(db, actor, taskId).catch((e: Error) => ({ skipped: e.message }));
  if (!r) return null;
  if ("skipped" in r) return `기획안 결재 반영 안 됨: ${r.skipped}`;
  await dispatchJob(r.rebaseJobId, "plan_rebase").catch(() => undefined);
  return `기획안 v${r.versionNo}을 결재본으로 반영했습니다. 홍보·집행 등 다른 국서 레퍼런스가 이 기획안을 기준으로 만들어집니다.`;
}
