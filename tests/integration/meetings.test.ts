import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetAllTables } from "@/lib/setup/reset";
import { ensureBaseSetup } from "@/lib/setup/bootstrap";
import { createMeeting, listMeetings, requestReextract } from "@/lib/services/meetings";
import { runExtractJob, TRANSIENT_FAILURE_MESSAGE } from "@/lib/jobs/extract";
import { ServiceError } from "@/lib/services/invitations";
import { ForbiddenError, type Actor } from "@/lib/auth/can";
import type { Storage } from "@/lib/storage";
import { signedFileUrl, verifySignature, SIGNED_URL_TTL_SEC } from "@/lib/storage/signed-url";

/** 업로드 → 저장 → 추출 작업 → 상태 전이 (T1) — 테스트 DB + 메모리 저장소 */
class MemoryStorage implements Storage {
  readonly driver = "local" as const;
  files = new Map<string, Uint8Array>();
  failGets = 0;
  async put(key: string, data: Uint8Array) { this.files.set(key, data); }
  async get(key: string) {
    if (this.failGets > 0) { this.failGets--; throw new Error("일시적 저장소 오류"); }
    return this.files.get(key) ?? null;
  }
  async delete(key: string) { this.files.delete(key); }
}

const fx = (name: string) => new Uint8Array(readFileSync(path.join("tests/fixtures/minutes", name)));
let storage: MemoryStorage;
let actor: Actor & { termId: string };

beforeAll(() => {
  if (!/kgb_test/.test(process.env.DATABASE_URL ?? "")) throw new Error("kgb_test 전용");
  process.env.WORKER_MODE = "off";
});
afterAll(async () => prisma.$disconnect());
beforeEach(async () => {
  await resetAllTables(prisma);
  const term = await ensureBaseSetup(prisma);
  const u = await prisma.user.create({ data: { email: "p@t.test", display_name: "회장", status: "active" } });
  await prisma.membership.create({ data: { user_id: u.id, term_id: term.id, role: "president" } });
  actor = { userId: u.id, role: "president", departmentId: null, departmentCode: null, termId: term.id };
  storage = new MemoryStorage();
});

const meta = { meetingDate: "2026-11-03", meetingType: "regular" as const };

async function upload(name: string) {
  return createMeeting(prisma, storage, actor, { ...meta, kind: "file", fileName: name, bytes: fx(name) });
}

describe("업로드 → 추출 (T1)", () => {
  it.each(["minutes.docx", "minutes.hwpx", "minutes-2up.pdf", "minutes.txt", "minutes.hwp"])("%s: extracted + 원문 저장 + 감사 로그", async (name) => {
    const { meetingId, aiJobId } = await upload(name);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } })).status).toBe("uploaded");
    expect(await runExtractJob(prisma, storage, aiJobId)).toBe("extracted");
    const m = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { files: true } });
    expect(m.status).toBe("extracted");
    expect(m.files[0]!.extracted_text).toContain("12월 10일 종강 간식 행사 진행");
    expect(m.files[0]!.extraction_error).toBeNull();
    expect(m.files[0]!.original_name).toBe(name);
    expect(m.files[0]!.storage_key).toMatch(/^minutes\/\d{4}\/\d{2}\//); // 원래 파일명은 저장 키에 없음
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: aiJobId } })).status).toBe("succeeded");
    const actions = (await prisma.activityLog.findMany({ where: { entity_id: meetingId } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["meeting.upload", "meeting.extracted"]));
  });

  it("스캔 PDF → failed + 안내 문구, 재시도하지 않음", async () => {
    const { meetingId, aiJobId } = await upload("scanned.pdf");
    expect(await runExtractJob(prisma, storage, aiJobId)).toBe("failed");
    const m = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { files: true } });
    expect(m.status).toBe("failed");
    expect(m.files[0]!.extraction_error).toMatch(/텍스트 레이어/);
    expect(await prisma.aiJob.findUniqueOrThrow({ where: { id: aiJobId } })).toMatchObject({ status: "failed", error: "pdf_scanned", attempts: 1 });
  });

  it("손상 PDF(헤더만 정상) → failed + 안내", async () => {
    const { meetingId, aiJobId } = await upload("corrupt.pdf");
    await runExtractJob(prisma, storage, aiJobId);
    const f = await prisma.meetingFile.findFirstOrThrow({ where: { meeting_id: meetingId } });
    expect(f.extraction_error).toMatch(/손상/);
  });

  it("형식이 맞지 않는 파일은 업로드 단계에서 거부(저장하지 않음)", async () => {
    await expect(upload("not-a-pdf.pdf")).rejects.toBeInstanceOf(ServiceError);
    await expect(upload("program.exe")).rejects.toThrow(/지원하지 않는/);
    expect(await prisma.meeting.count()).toBe(0);
    expect(storage.files.size).toBe(0);
  });

  it("붙여넣기: source=paste, 추출 방식 paste, 제목은 첫 줄", async () => {
    const { meetingId, aiJobId } = await createMeeting(prisma, storage, actor, { ...meta, kind: "paste", text: "\n# 임시회의 메모\n- 안건 1\n" });
    await runExtractJob(prisma, storage, aiJobId);
    const m = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { files: true } });
    expect(m).toMatchObject({ source: "paste", status: "extracted", title: "임시회의 메모" });
    expect(m.files[0]!.extraction_method).toBe("paste");
    await expect(createMeeting(prisma, storage, actor, { ...meta, kind: "paste", text: "   " })).rejects.toThrow(/붙여넣어/);
  });

  it("입력 검증: 회의일·유형", async () => {
    await expect(createMeeting(prisma, storage, actor, { meetingDate: "", meetingType: "regular", kind: "paste", text: "x" })).rejects.toThrow(/회의일/);
    await expect(createMeeting(prisma, storage, actor, { meetingDate: "2026-11-03", meetingType: "bogus" as "regular", kind: "paste", text: "x" })).rejects.toThrow(/유형/);
  });

  it("업로드 용량 상한(설정값)", async () => {
    await prisma.setting.update({ where: { term_id_key: { term_id: actor.termId, key: "UPLOAD_MAX_MB" } }, data: { value: 0.0001 } });
    await expect(upload("minutes-2up.pdf")).rejects.toThrow(/너무 큽니다/);
  });

  it("같은 작업을 두 번 실행해도 한 번만 처리(중복 전송 안전)", async () => {
    const { aiJobId } = await upload("minutes.txt");
    expect(await runExtractJob(prisma, storage, aiJobId)).toBe("extracted");
    expect(await runExtractJob(prisma, storage, aiJobId)).toBe("skipped");
  });

  it("일시 오류는 재시도, 3회 모두 실패하면 failed + 안내", async () => {
    const { meetingId, aiJobId } = await upload("minutes.txt");
    storage.failGets = 3;
    await expect(runExtractJob(prisma, storage, aiJobId)).rejects.toThrow(/일시적/);
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: aiJobId } })).status).toBe("queued");
    await expect(runExtractJob(prisma, storage, aiJobId)).rejects.toThrow();
    expect(await runExtractJob(prisma, storage, aiJobId)).toBe("failed");
    const f = await prisma.meetingFile.findFirstOrThrow({ where: { meeting_id: meetingId } });
    expect(f.extraction_error).toBe(TRANSIENT_FAILURE_MESSAGE);
  });

  it("다시 추출: 실패 후 새 작업으로 재처리", async () => {
    const { meetingId, aiJobId } = await upload("minutes.txt");
    storage.failGets = 3;
    for (let i = 0; i < 3; i++) await runExtractJob(prisma, storage, aiJobId).catch(() => undefined);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } })).status).toBe("failed");
    const { aiJobId: second } = await requestReextract(prisma, actor, meetingId);
    expect(second).not.toBe(aiJobId);
    expect(await runExtractJob(prisma, storage, second)).toBe("extracted");
    await expect(requestReextract(prisma, actor, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/찾을 수 없/);
  });
});

describe("권한 (Q4)", () => {
  it("국원은 기본적으로 업로드 불가, 설정으로 허용 가능", async () => {
    const dept = await prisma.department.findFirstOrThrow({ where: { code: "planning" } });
    const member = { ...actor, role: "member" as const, departmentId: dept.id, departmentCode: "planning" };
    await expect(createMeeting(prisma, storage, member, { ...meta, kind: "paste", text: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await prisma.setting.update({ where: { term_id_key: { term_id: actor.termId, key: "MEMBER_CAN_UPLOAD_MINUTES" } }, data: { value: true } });
    await expect(createMeeting(prisma, storage, member, { ...meta, kind: "paste", text: "x" })).resolves.toBeTruthy();
  });
});

describe("목록 필터", () => {
  it("제목·기간·유형", async () => {
    await createMeeting(prisma, storage, actor, { meetingDate: "2026-10-27", meetingType: "regular", kind: "paste", text: "제22차 정기회의" });
    await createMeeting(prisma, storage, actor, { meetingDate: "2026-11-05", meetingType: "department", kind: "paste", text: "홍보국 회의" });
    expect((await listMeetings(prisma, actor.termId, {})).map((m) => m.title)).toEqual(["홍보국 회의", "제22차 정기회의"]);
    expect((await listMeetings(prisma, actor.termId, { q: "정기" })).map((m) => m.title)).toEqual(["제22차 정기회의"]);
    expect((await listMeetings(prisma, actor.termId, { from: "2026-11-01" })).map((m) => m.title)).toEqual(["홍보국 회의"]);
    expect((await listMeetings(prisma, actor.termId, { type: "regular", to: "2026-10-31" })).map((m) => m.title)).toEqual(["제22차 정기회의"]);
  });
});

describe("서명 URL (10-3, T12 일부)", () => {
  it("10분 만료, 위조 거부", () => {
    const now = Date.now();
    const url = new URL(signedFileUrl("minutes/2026/10/0192f0a0-0000-7000-8000-000000000000", { now }), "http://x");
    const key = url.searchParams.get("key")!;
    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    expect(verifySignature(key, exp, sig, now)).toEqual({ ok: true });
    expect(verifySignature(key, exp, sig, now + SIGNED_URL_TTL_SEC * 1000 + 1000)).toEqual({ ok: false, reason: "expired" });
    expect(verifySignature("minutes/2026/10/other", exp, sig, now)).toEqual({ ok: false, reason: "invalid" });
    expect(verifySignature(key, exp, "x", now)).toEqual({ ok: false, reason: "invalid" });
    expect(verifySignature(key, "abc", sig, now)).toEqual({ ok: false, reason: "invalid" });
  });
});
