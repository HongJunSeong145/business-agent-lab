import { describe, expect, it } from "vitest";
import { assertCan, can, ForbiddenError, isLeader, type Action, type ActionType, type Actor } from "@/lib/auth/can";

/**
 * 권한 매트릭스 전 항목 (지시서 10-2 + 사용자 결정 N10: 국장 = 회장 동등, 부회장 없음).
 * T23 의 함수 수준 검증. API 수준 검증은 각 Phase 에서 해당 엔드포인트가 생길 때 추가한다.
 */
const PLAN = "dept-planning";
const FIN = "dept-finance";
const PRO = "dept-promotion";

const admin: Actor = { userId: "u-admin", role: "admin", departmentId: null, departmentCode: null };
const president: Actor = { userId: "u-pres", role: "president", departmentId: null, departmentCode: null };
const head: Actor = { userId: "u-head", role: "head", departmentId: PLAN, departmentCode: "planning" };
const member: Actor = { userId: "u-mem", role: "member", departmentId: PRO, departmentCode: "promotion" };
const financeMember: Actor = { userId: "u-fin", role: "member", departmentId: FIN, departmentCode: "finance" };

const otherTask = { assigneeIds: ["someone"], departmentIds: [PLAN] };
const ownTask = { assigneeIds: [member.userId], departmentIds: [PLAN] };
const deptTask = { assigneeIds: ["someone"], departmentIds: [PLAN, PRO] };

// [action, admin, president, head, member(타인/무관 자원)]
const matrix: [Action, boolean, boolean, boolean, boolean][] = [
  [{ type: "meeting.upload" }, true, true, true, false],
  [{ type: "meeting.reanalyze" }, true, true, true, false],
  [{ type: "meeting.view" }, true, true, true, true],
  [{ type: "proposal.approve" }, true, true, true, false],
  [{ type: "project.create" }, true, true, true, false],
  [{ type: "project.confirmSchedule" }, true, true, true, false],
  [{ type: "project.cancel" }, true, true, true, false],
  [{ type: "task.create" }, true, true, true, false],
  [{ type: "task.assign" }, true, true, true, false],
  [{ type: "task.confirmDeadline" }, true, true, true, false],
  [{ type: "task.requestDeadlineChange", task: otherTask }, true, true, true, false],
  [{ type: "deliverable.upload", task: otherTask }, true, true, true, false],
  [{ type: "deliverable.view" }, true, true, true, true],
  [{ type: "task.adjustProgress", task: otherTask }, true, true, true, false],
  [{ type: "task.complete", task: otherTask }, true, true, true, false],
  [{ type: "plan.approve" }, true, true, true, false],
  [{ type: "plan.edit" }, true, true, true, false],
  [{ type: "reference.view" }, true, true, true, true],
  [{ type: "reference.add", task: otherTask }, true, true, true, false],
  [{ type: "finance.edit" }, true, true, true, false],
  [{ type: "evidence.upload" }, true, true, true, true],
  [{ type: "profile.view" }, true, true, true, true],
  [{ type: "profile.edit", profile: { userId: "someone" } }, true, true, true, false],
  [{ type: "profile.create" }, true, true, true, false],
  [{ type: "contacts.editRows" }, true, true, true, true],
  [{ type: "contacts.editColumns" }, true, true, true, false],
  [{ type: "settings.manage" }, true, true, true, false],
  [{ type: "members.manage" }, true, true, true, false],
  [{ type: "backup.manage" }, true, false, false, false],
];

describe("권한 매트릭스", () => {
  it("모든 action 유형을 표에서 검증한다", () => {
    const covered = new Set(matrix.map(([a]) => a.type));
    const all: ActionType[] = [
      "meeting.upload", "meeting.reanalyze", "meeting.view", "proposal.approve", "project.create", "project.confirmSchedule",
      "project.cancel", "task.create", "task.assign", "task.confirmDeadline", "task.requestDeadlineChange", "deliverable.upload",
      "deliverable.view", "task.adjustProgress", "task.complete", "plan.approve", "plan.edit", "reference.view", "reference.add", "finance.edit", "evidence.upload", "profile.view",
      "profile.edit", "profile.create", "contacts.editRows", "contacts.editColumns", "settings.manage", "members.manage", "backup.manage",
    ];
    expect([...covered].sort()).toEqual([...all].sort());
  });

  it.each(matrix)("%o → admin %s / president %s / head %s / member %s", (action, a, p, h, m) => {
    expect(can(admin, action)).toBe(a);
    expect(can(president, action)).toBe(p);
    expect(can(head, action)).toBe(h);
    expect(can(member, action)).toBe(m);
  });
});

describe("국원의 자원 기반 권한", () => {
  it("자기 담당 업무: 진척도 조정·완료 체크·마감 변경 요청·작업물 업로드 가능", () => {
    for (const type of ["task.adjustProgress", "task.complete", "task.requestDeadlineChange", "deliverable.upload"] as const) {
      expect(can(member, { type, task: ownTask })).toBe(true);
    }
  });
  it("자기 국서가 참여(협조 포함)한 업무: 작업물 업로드만 가능", () => {
    expect(can(member, { type: "deliverable.upload", task: deptTask })).toBe(true);
    expect(can(member, { type: "task.complete", task: deptTask })).toBe(false);
    expect(can(member, { type: "task.adjustProgress", task: deptTask })).toBe(false);
  });
  it("국서 미지정 국원은 국서 참여 조건을 만족하지 않음", () => {
    const noDept: Actor = { ...member, departmentId: null };
    expect(can(noDept, { type: "deliverable.upload", task: deptTask })).toBe(false);
  });
  it("재정국 국원은 예결산·증빙 편집 가능, 타 국서 국원은 불가", () => {
    expect(can(financeMember, { type: "finance.edit" })).toBe(true);
    expect(can(member, { type: "finance.edit" })).toBe(false);
  });
  it("인적사항: 본인 행만 편집 (T21)", () => {
    expect(can(member, { type: "profile.edit", profile: { userId: member.userId } })).toBe(true);
    expect(can(member, { type: "profile.edit", profile: { userId: "someone" } })).toBe(false);
    expect(can(member, { type: "profile.edit", profile: { userId: null } })).toBe(false);
  });
  it("Q4 설정으로 국원 회의록 업로드 허용 가능", () => {
    expect(can(member, { type: "meeting.upload" }, { memberCanUploadMinutes: true })).toBe(true);
    expect(can(member, { type: "meeting.reanalyze" }, { memberCanUploadMinutes: true })).toBe(true);
  });
});

describe("국장 = 회장 (N10)", () => {
  it("국장은 타 국서 업무·전체 제안 승인·기획안 결재·설정까지 회장과 동일", () => {
    const allActions = matrix.map(([a]) => a);
    for (const a of allActions) expect(can(head, a)).toBe(can(president, a));
  });
  it("isLeader", () => {
    expect([admin, president, head, member].map(isLeader)).toEqual([true, true, true, false]);
  });
});

describe("assertCan", () => {
  it("권한 없으면 403 ForbiddenError", () => {
    expect(() => assertCan(member, { type: "members.manage" })).toThrow(ForbiddenError);
    try {
      assertCan(member, { type: "members.manage" });
    } catch (e) {
      expect((e as ForbiddenError).status).toBe(403);
    }
    expect(() => assertCan(head, { type: "members.manage" })).not.toThrow();
  });
});
