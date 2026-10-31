import { describe, expect, it } from "vitest";
import { nextAutoStatus, taskReadiness, type Predecessor } from "../src/readiness";
import { wouldCreateCycle } from "../src/graph";

const p = (over: Partial<Predecessor> = {}): Predecessor => ({ title: "기획안 초안", status: "todo", is_completed: false, effective_progress: 0, ...over });

describe("taskReadiness (D7)", () => {
  it("의존 없으면 착수 가능", () => {
    expect(taskReadiness([], false)).toEqual({ blocked: false, reasons: [], startedOnDraft: false });
  });
  it("finish_to_start: 완료 전 차단, 완료(체크 또는 done) 후 해제", () => {
    expect(taskReadiness([{ type: "finish_to_start", predecessor: p() }], false)).toMatchObject({ blocked: true, reasons: ["'기획안 초안' 완료 대기"] });
    expect(taskReadiness([{ type: "finish_to_start", predecessor: p({ is_completed: true }) }], false).blocked).toBe(false);
    expect(taskReadiness([{ type: "finish_to_start", predecessor: p({ status: "done" }) }], false).blocked).toBe(false);
  });
  it("approval_required: 결재 완료 전 차단, 국장 허용 시 초안 기준 선착수", () => {
    const pre = p({ title: "기획안 결재", status: "in_progress" });
    expect(taskReadiness([{ type: "approval_required", predecessor: pre }], false)).toMatchObject({ blocked: true, reasons: ["'기획안 결재' 결재 대기"] });
    expect(taskReadiness([{ type: "approval_required", predecessor: pre }], true)).toEqual({ blocked: false, reasons: [], startedOnDraft: true });
    // 허용해도 초안이 없으면 차단
    expect(taskReadiness([{ type: "approval_required", predecessor: p({ title: "기획안 결재" }) }], true).blocked).toBe(true);
    // 결재 완료면 선착수 표시 없이 해제
    expect(taskReadiness([{ type: "approval_required", predecessor: p({ is_completed: true }) }], true)).toEqual({ blocked: false, reasons: [], startedOnDraft: false });
  });
  it("draft_ok: 선행이 착수(진행·검토·완료·진척>0)되면 해제", () => {
    expect(taskReadiness([{ type: "draft_ok", predecessor: p() }], false)).toMatchObject({ blocked: true, reasons: ["'기획안 초안' 초안 대기"] });
    for (const over of [{ status: "in_progress" }, { status: "review" }, { effective_progress: 10 }, { is_completed: true }]) {
      expect(taskReadiness([{ type: "draft_ok", predecessor: p(over) }], false).blocked).toBe(false);
    }
  });
  it("취소된 선행은 막지 않음, 여러 의존은 모두 충족해야", () => {
    expect(taskReadiness([{ type: "finish_to_start", predecessor: p({ status: "cancelled" }) }], false).blocked).toBe(false);
    const r = taskReadiness([
      { type: "finish_to_start", predecessor: p({ title: "A", is_completed: true }) },
      { type: "finish_to_start", predecessor: p({ title: "B" }) },
    ], false);
    expect(r.reasons).toEqual(["'B' 완료 대기"]);
  });
});

describe("nextAutoStatus", () => {
  const blocked = { blocked: true, reasons: ["x"], startedOnDraft: false };
  const ready = { blocked: false, reasons: [], startedOnDraft: false };
  it("blocked/todo 사이에서만 자동 전환", () => {
    expect(nextAutoStatus("todo", blocked)).toBe("blocked");
    expect(nextAutoStatus("blocked", ready)).toBe("todo");
    expect(nextAutoStatus("in_progress", blocked)).toBe("in_progress");
    expect(nextAutoStatus("done", blocked)).toBe("done");
  });
});

describe("wouldCreateCycle (4-3)", () => {
  const edges = [["B", "A"], ["C", "B"]] as const; // B→A, C→B
  it("자기 자신 의존은 순환", () => expect(wouldCreateCycle(edges, "A", "A")).toBe(true));
  it("간접 순환 탐지: A 가 C 에 의존하면 A→C→B→A", () => expect(wouldCreateCycle(edges, "A", "C")).toBe(true));
  it("순환 아님", () => {
    expect(wouldCreateCycle(edges, "C", "A")).toBe(false);
    expect(wouldCreateCycle(edges, "D", "C")).toBe(false);
  });
  it("다이아몬드 구조(중복 방문)도 정상", () => {
    const d = [["B", "A"], ["C", "A"], ["D", "B"], ["D", "C"]] as const;
    expect(wouldCreateCycle(d, "E", "D")).toBe(false);
    expect(wouldCreateCycle(d, "A", "D")).toBe(true);
  });
});
