import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectMinutesKind, UploadRejectedError } from "@/lib/files/detect";
import { extractMinutes, ExtractionError } from "@/lib/extract";
import { normalizeText, meaningfulLength } from "@/lib/extract/normalize";
import { decodeParaText, paraTextsFromRecords } from "@/lib/extract/hwp";
import { toParagraphs } from "@/lib/minutes-text";
import { MUST_CONTAIN, TABLE_ROWS } from "../fixtures/minutes/content";

const fx = (name: string) => new Uint8Array(readFileSync(path.join("tests/fixtures/minutes", name)));

async function extractFile(name: string) {
  const bytes = fx(name);
  return extractMinutes(detectMinutesKind(name, bytes), bytes);
}

/** T1: 형식별 추출 — 모든 형식에서 같은 핵심 문장이 나와야 한다 */
describe.each([
  ["minutes.pdf", "pdf_text"],
  ["minutes-2up.pdf", "pdf_text"],
  ["minutes.docx", "docx"],
  ["minutes.hwpx", "hwpx"],
  ["minutes.hwp", "hwp_best_effort"],
  ["minutes.txt", "plain"],
  ["minutes.md", "plain"],
  ["minutes-euckr.txt", "plain"],
])("%s", (name, method) => {
  it(`추출 방식 ${method}, 핵심 문장 포함`, async () => {
    const r = await extractFile(name);
    expect(r.method).toBe(method);
    for (const s of MUST_CONTAIN) expect(r.text).toContain(s);
  });
});

describe("PDF", () => {
  it("한 장에 두 쪽(2-up) 인쇄본은 왼쪽 쪽 → 오른쪽 쪽 순서로 읽는다 (실제 회의록 샘플 형식)", async () => {
    const { text } = await extractFile("minutes-2up.pdf");
    const order = ["1. 종강 간식 행사에 관한 건", "-> 기획국이 다음주 월요일까지 기획안 작성", "2. 시험기간 패트롤 피드백", "국서별 업무 지시 사항", "간식 행사 카드뉴스 제작"];
    const idx = order.map((s) => text.indexOf(s));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    // 표 한 행은 한 줄로
    expect(text).toMatch(/홍보국 1\. 간식 행사 카드뉴스 제작 11\. 24\(화\)/);
    // 쪽 번호 줄은 제거
    expect(text).not.toMatch(/^- 1 -$/m);
  });
  it("스캔 PDF(텍스트 레이어 없음)는 안내와 함께 실패", async () => {
    await expect(extractFile("scanned.pdf")).rejects.toMatchObject({ code: "pdf_scanned", message: expect.stringMatching(/텍스트 레이어|스캔/) });
  });
  it("손상된 PDF는 안내와 함께 실패", async () => {
    await expect(extractFile("corrupt.pdf")).rejects.toBeInstanceOf(ExtractionError);
    await expect(extractFile("corrupt.pdf")).rejects.toMatchObject({ message: expect.stringContaining("다시 올려 주세요") });
  });
});

describe("HWPX", () => {
  it("표는 행마다 '칸 | 칸 | 칸'", async () => {
    const { text } = await extractFile("minutes.hwpx");
    for (const row of TABLE_ROWS) expect(text).toContain(row.join(" | "));
  });
});

describe("HWP (최선 노력, D14)", () => {
  it("본문 해석 실패 시 미리보기 텍스트 + 안내", async () => {
    const { text } = await extractFile("minutes-prvtext-only.hwp");
    expect(text).toContain("제9대 데모단과대학 학생회 제5차 회의록");
    expect(text).toMatch(/미리보기 텍스트\(앞부분\)만 추출/);
  });
  it("암호 문서는 PDF/HWPX 재업로드 안내", async () => {
    await expect(extractFile("encrypted.hwp")).rejects.toMatchObject({ code: "hwp_encrypted", message: expect.stringContaining("PDF(텍스트 포함) 또는 HWPX") });
  });
  it("PARA_TEXT 디코딩: 확장 컨트롤(8 WCHAR) 건너뛰기, 탭(인라인 컨트롤 8 WCHAR)·줄바꿈 유지", () => {
    const chars = [2, 0, 0, 0, 0, 0, 0, 0, 0x110b, 9, 0, 0, 0, 0, 0, 0, 0, 0x41, 10, 0x42, 13];
    const buf = new Uint8Array(chars.length * 2);
    chars.forEach((c, i) => new DataView(buf.buffer).setUint16(i * 2, c, true));
    expect(decodeParaText(buf)).toBe("ᄋ\tA\nB");
  });
  it("레코드 파서: 큰 레코드(size=0xFFF 확장 길이)와 잘린 데이터", () => {
    const payload = new Uint8Array(5000).fill(0x20);
    const rec = new Uint8Array(8 + payload.byteLength);
    const dv = new DataView(rec.buffer);
    dv.setUint32(0, 67 | (0xfff << 20), true);
    dv.setUint32(4, payload.byteLength, true);
    rec.set(payload, 8);
    expect(paraTextsFromRecords(rec)).toHaveLength(1);
    expect(paraTextsFromRecords(rec.subarray(0, 100))).toHaveLength(0);
  });
});

describe("업로드 형식 판정 (10-3)", () => {
  it("허용 목록 밖 확장자 거부(실행 파일 등)", () => {
    expect(() => detectMinutesKind("program.exe", fx("program.exe"))).toThrow(UploadRejectedError);
    expect(() => detectMinutesKind("minutes", fx("minutes.txt"))).toThrow(/확장자 없음/);
  });
  it("확장자와 내용(매직바이트) 불일치 거부", () => {
    expect(() => detectMinutesKind("not-a-pdf.pdf", fx("not-a-pdf.pdf"))).toThrow(/형식이 아닙니다/);
    expect(() => detectMinutesKind("x.docx", fx("minutes.hwpx"))).toThrow(/형식이 아닙니다/);
    expect(() => detectMinutesKind("x.hwpx", fx("minutes.docx"))).toThrow(/형식이 아닙니다/);
    expect(() => detectMinutesKind("x.hwp", fx("minutes.pdf"))).toThrow(/형식이 아닙니다/);
    expect(() => detectMinutesKind("corrupt.hwpx", fx("corrupt.hwpx"))).toThrow(/형식이 아닙니다/);
    expect(() => detectMinutesKind("x.txt", fx("program.exe"))).toThrow(/텍스트 파일이 아닙니다/);
  });
  it("대소문자 확장자 허용, 빈 파일 거부", () => {
    expect(detectMinutesKind("회의록.PDF", fx("minutes.pdf"))).toBe("pdf");
    expect(() => detectMinutesKind("a.txt", new Uint8Array())).toThrow(/빈 파일/);
  });
});

describe("텍스트 정리·문단", () => {
  it("줄바꿈 통일·쪽 번호 제거·빈 줄 축약", () => {
    expect(normalizeText("가\r\n\r\n\r\n\r\n나  \n- 12 -\n다\u0000")).toBe("가\n\n나\n다");
    expect(meaningfulLength("- 3 - ! ?")).toBe(1);
  });
  it("문단 번호는 빈 줄을 제외하고 1부터", () => {
    expect(toParagraphs("가\n\n나\n  \n다")).toEqual([{ n: 1, text: "가" }, { n: 2, text: "나" }, { n: 3, text: "다" }]);
  });
  it("내용 없는 텍스트는 실패", async () => {
    await expect(extractMinutes("txt", new TextEncoder().encode("   \n - 1 - \n"))).rejects.toMatchObject({ code: "empty" });
  });
});
