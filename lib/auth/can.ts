/**
 * 권한 판단의 단일 진입점 (지시서 10-1). UI 숨김과 서버(API/Server Action) 강제에 같은 함수를 쓴다.
 *
 * 역할 체계 (ADR-016, 사용자 결정 N10):
 *   admin ⊇ president = head ⊋ member
 *   - 부회장 없음. 국장(head)은 회장과 동등한 권한.
 *   - 백업만 admin 전용.
 *   - member 권한은 지시서 10-2 그대로 (Q4·Q5 기본값 포함).
 */

export const ROLES = ["admin", "president", "head", "member"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "관리자",
  president: "학생회장",
  head: "국장",
  member: "국원",
};

export type Actor = {
  userId: string;
  role: Role;
  departmentId: string | null;
  departmentCode: string | null;
};

/** 권한 판단에 필요한 자원 정보 */
export type TaskResource = {
  assigneeIds: string[];
  departmentIds: string[]; // 주관 + 협조
};

export type ProfileResource = { userId: string | null };

export type Settings = { memberCanUploadMinutes: boolean };

export type Action =
  | { type: "meeting.upload" }
  | { type: "meeting.reanalyze" }
  | { type: "meeting.view" }
  | { type: "proposal.approve" }
  | { type: "project.create" }
  | { type: "project.confirmSchedule" }
  | { type: "project.cancel" }
  | { type: "task.create" }
  | { type: "task.assign" }
  | { type: "task.confirmDeadline" }
  | { type: "task.requestDeadlineChange"; task: TaskResource }
  | { type: "deliverable.upload"; task: TaskResource }
  | { type: "deliverable.view" }
  | { type: "task.adjustProgress"; task: TaskResource }
  | { type: "task.complete"; task: TaskResource }
  | { type: "plan.approve" }
  | { type: "plan.edit" }
  | { type: "reference.view" }
  | { type: "reference.add"; task: TaskResource }
  | { type: "finance.edit" }
  | { type: "evidence.upload" }
  | { type: "profile.view" }
  | { type: "profile.edit"; profile: ProfileResource }
  | { type: "profile.create" }
  | { type: "contacts.editRows" }
  | { type: "contacts.editColumns" }
  | { type: "settings.manage" }
  | { type: "members.manage" }
  | { type: "backup.manage" };

export type ActionType = Action["type"];

const DEFAULT_SETTINGS: Settings = { memberCanUploadMinutes: false };

/** 회장급(회장·국장·관리자) — 사용자 결정 N10 */
export function isLeader(actor: Actor): boolean {
  return actor.role === "admin" || actor.role === "president" || actor.role === "head";
}

function isAssignee(actor: Actor, task: TaskResource): boolean {
  return task.assigneeIds.includes(actor.userId);
}

function inTaskDepartment(actor: Actor, task: TaskResource): boolean {
  return actor.departmentId !== null && task.departmentIds.includes(actor.departmentId);
}

export function can(actor: Actor, action: Action, settings: Settings = DEFAULT_SETTINGS): boolean {
  if (action.type === "backup.manage") return actor.role === "admin";
  if (isLeader(actor)) return true;

  // ── 이하 member ──
  switch (action.type) {
    case "meeting.view":
    case "deliverable.view":
    case "evidence.upload":
    case "profile.view":
    case "contacts.editRows":
      return true;

    case "meeting.upload":
    case "meeting.reanalyze":
      return settings.memberCanUploadMinutes; // Q4 기본 불허

    case "task.requestDeadlineChange":
    case "task.adjustProgress":
    case "task.complete":
      return isAssignee(actor, action.task);

    case "deliverable.upload":
    case "reference.add": // 링크·파일 추가와 AI 제작 의뢰
      return isAssignee(actor, action.task) || inTaskDepartment(actor, action.task);

    case "reference.view":
      return true;

    case "plan.edit": // 기획안 작성은 기획국(6-3), 결재는 회장·국장
      return actor.departmentCode === "planning";

    case "finance.edit":
      return actor.departmentCode === "finance";

    case "profile.edit":
      return action.profile.userId !== null && action.profile.userId === actor.userId;

    case "proposal.approve":
    case "project.create":
    case "project.confirmSchedule":
    case "project.cancel":
    case "task.create":
    case "task.assign":
    case "task.confirmDeadline": // Q5: 국원은 변경 '요청'만
    case "plan.approve":
    case "profile.create":
    case "contacts.editColumns":
    case "settings.manage":
    case "members.manage":
      return false;
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(action: ActionType) {
    super(`권한이 없습니다: ${action}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(actor: Actor, action: Action, settings?: Settings): void {
  if (!can(actor, action, settings)) throw new ForbiddenError(action.type);
}
