import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DELIVERABLE_ACCEPT as SERVER_ACCEPT, detectDeliverableKind, previewKind } from "@/lib/files/deliverable";
import { DELIVERABLE_ACCEPT as CLIENT_ACCEPT } from "@/components/tasks/deliverables-tab";
import { extractPptx } from "@/lib/extract/pptx";
import { normalizeScore, scoreBounds } from "@/lib/ai/schemas/a6";
import { criteriaFor } from "@/lib/ai/a6-criteria";
import { evaluability } from "@/lib/services/deliverables";

const b = (...xs: number[]) => Uint8Array.from(xs);
const s = (x: string) => strToU8(x);

describe("작업물 형식 판정", () => {
  it("매직바이트가 맞는 형식만 받는다", () => {
    expect(detectDeliverableKind("a.png", b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("png");
    expect(detectDeliverableKind("a.JPG", b(0xff, 0xd8, 0xff, 0xe0))).toBe("jpg");
    expect(detectDeliverableKind("a.gif", s("GIF89a..."))).toBe("gif");
    expect(detectDeliverableKind("a.webp", s("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(detectDeliverableKind("a.mp4", b(0, 0, 0, 0x18, ...s("ftypmp42")))).toBe("mp4");
    expect(detectDeliverableKind("a.webm", b(0x1a, 0x45, 0xdf, 0xa3, 0))).toBe("webm");
    expect(detectDeliverableKind("a.pdf", new Uint8Array(readFileSync("tests/fixtures/minutes/minutes.pdf")))).toBe("pdf");
    expect(detectDeliverableKind("a.pptx", zipSync({ "ppt/presentation.xml": s("<x/>") }))).toBe("pptx");
    for (const [n, bytes] of [["a.png", s("hello")], ["a.jpg", s("GIF8")], ["a.gif", s("PNG")], ["a.webp", s("RIFF0000WAVE")], ["a.mov", s("12345678")], ["a.webm", s("x")], ["a.pptx", zipSync({ "word/document.xml": s("x") })], ["a.pptx", s("PK\x03\x04broken")]] as const) {
      expect(() => detectDeliverableKind(n, bytes), n).toThrow(/형식이 아닙니다/);
    }
    expect(() => detectDeliverableKind("a.svg", s("<svg/>"))).toThrow(/지원하지 않는.*이미지/);
    expect(() => detectDeliverableKind("a.html", s("<html>"))).toThrow(/지원하지 않는/);
    expect(() => detectDeliverableKind("a.png", new Uint8Array())).toThrow(/빈 파일/);
    expect(() => detectDeliverableKind("a.txt", b(0, 1, 2))).toThrow(/텍스트 파일이 아닙니다/);
  });
  it("미리보기 방식·업로드 허용 목록 일치", () => {
    expect(previewKind("image/png")).toBe("image");
    expect(previewKind("application/pdf")).toBe("pdf");
    expect(previewKind("video/mp4")).toBe("video");
    expect(previewKind("text/plain")).toBe("text");
    expect(previewKind(null)).toBe("link");
    expect(CLIENT_ACCEPT).toBe(SERVER_ACCEPT);
  });
});

describe("PPTX 추출", () => {
  it("슬라이드 순서대로, 문단마다 한 줄, 엔티티 복원", () => {
    const z = zipSync({
      "ppt/slides/slide10.xml": s("<a:p><a:r><a:t>열번째</a:t></a:r></a:p>"),
      "ppt/slides/slide2.xml": s('<a:p><a:r><a:t xml:space="preserve">일시 &amp; 장소</a:t></a:r><a:r><a:t> &#x41;&#66;</a:t></a:r></a:p><a:p><a:r><a:t>둘째 줄</a:t></a:r></a:p>'),
      "ppt/slides/slide1.xml": s("<a:p><a:r><a:t>행사명</a:t></a:r></a:p>"),
    });
    expect(extractPptx(z)).toBe("[슬라이드 1]\n행사명\n\n[슬라이드 2]\n일시 & 장소 AB\n둘째 줄\n\n[슬라이드 3]\n열번째\n");
    expect(() => extractPptx(s("not a zip"))).toThrow(/PPTX/);
  });
});

describe("A6 점수·기준", () => {
  const c = (...v: ("met" | "partial" | "unmet")[]) => v.map((verdict, i) => ({ criterion: `c${i}`, verdict, evidence: "" }));
  it("판정과 크게 어긋난 점수는 판정 범위로 맞춘다", () => {
    expect(scoreBounds(c("met", "met"))).toEqual([80, 100]);
    expect(scoreBounds(c("unmet"))).toEqual([1, 15]);
    const base = { missing_items: [], suggestions: [], summary: "" };
    expect(normalizeScore({ ...base, criteria: c("unmet", "unmet"), score: 100 })).toBe(15);
    expect(normalizeScore({ ...base, criteria: c("met", "partial"), score: 70 })).toBe(70);
    expect(normalizeScore({ ...base, criteria: c("met", "met"), score: 20 })).toBe(80);
  });
  it("기준: 업무 기준 > 표준 업무 템플릿 기준 > 국서 기본", () => {
    expect(criteriaFor({ acceptance_criteria: [{ text: "A", done: false }, { text: " " }], template_key: "PLN_DRAFT" }, "planning")).toEqual({ list: ["A"], source: "task" });
    expect(criteriaFor({ acceptance_criteria: [], template_key: "PLN_DRAFT" }, "planning").list).toContain("배경 및 목적");
    expect(criteriaFor({ acceptance_criteria: null, template_key: null }, "promotion").list).toContain("오탈자 없음");
    expect(criteriaFor({ acceptance_criteria: null, template_key: "NOPE" }, "unknown").source).toBe("default");
  });
  it("평가 가능 여부", () => {
    const v = { mime: "image/png", size: 10, extracted_text: null, external_url: null, storage_key: "k" };
    expect(evaluability(v)).toBe("ok");
    expect(evaluability({ ...v, size: 6 * 1024 * 1024 })).toBe("image_too_large");
    expect(evaluability({ ...v, mime: "video/mp4" })).toBe("video");
    expect(evaluability({ ...v, mime: "application/pdf" })).toBe("no_text");
    expect(evaluability({ ...v, mime: "application/pdf", extracted_text: "x" })).toBe("ok");
    expect(evaluability({ ...v, storage_key: null, external_url: "https://x" })).toBe("link");
    expect(evaluability({ ...v, storage_key: null })).toBe("unknown");
  });
});
