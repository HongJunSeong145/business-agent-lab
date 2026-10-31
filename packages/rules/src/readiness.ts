/**
 * 업무 착수 가능 여부 (D7, ARCHITECTURE 6-5).
 * 의존 유형별 해제 조건:
 *  - finish_to_start   : 선행 업무 완료
 *  - approval_required : 선행 업무(결재 업무) 완료. 국장이 '초안 기반 선착수'를 허용하면 draft_ok 로 평가
 *  - draft_ok          : 선행 업무에 초안이 있음 = 선행이 착수됨(진행 중·검토·완료 또는 진척도 > 0)
 * 취소된 선행 업무는 더 이상 막지 않는다. 기획안 모듈(Phase 7)이 생기면 approval_required 는 기획안 결재와 연동된다.
 */
export type DependencyType = "finish_to_start" | "approval_required" | "draft_ok";

export type Predecessor = {
  title: string;
  status: string;
  is_completed: boolean;
  effective_progress: number;
};

export type Readiness = {
  blocked: boolean;
  /** 막고 있는 사유 (화면 표시용) */
  reasons: string[];
  /** 초안 기반 선착수 허용 덕분에 풀린 경우 */
  startedOnDraft: boolean;
};

function done(p: Predecessor): boolean {
  return p.is_completed || p.status === "done";
}

function draftExists(p: Predecessor): boolean {
  return done(p) || p.status === "in_progress" || p.status === "review" || p.effective_progress > 0;
}

export function taskReadiness(deps: { type: DependencyType; predecessor: Predecessor }[], allowDraftStart: boolean): Readiness {
  const reasons: string[] = [];
  let startedOnDraft = false;
  for (const { type, predecessor: p } of deps) {
    if (p.status === "cancelled") continue;
    if (type === "finish_to_start") {
      if (!done(p)) reasons.push(`'${p.title}' 완료 대기`);
    } else if (type === "approval_required") {
      if (done(p)) continue;
      if (allowDraftStart && draftExists(p)) startedOnDraft = true;
      else reasons.push(`'${p.title}' 결재 대기`);
    } else if (!draftExists(p)) {
      reasons.push(`'${p.title}' 초안 대기`);
    }
  }
  return { blocked: reasons.length > 0, reasons, startedOnDraft: reasons.length === 0 && startedOnDraft };
}

/** 자동 상태 계산은 blocked/todo 사이에서만 한다. 사용자가 진행 중 이후로 옮긴 업무는 건드리지 않는다. */
export function nextAutoStatus(current: string, r: Readiness): string {
  if (current !== "blocked" && current !== "todo") return current;
  return r.blocked ? "blocked" : "todo";
}
