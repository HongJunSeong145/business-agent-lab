import Link from "next/link";
import { AlertTriangle, Download, FileText, Loader2 } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/can";
import { getPermissionSettings } from "@/lib/settings";
import { getMeetingDetail, listMeetings, MEETING_STATUS_LABEL, MEETING_TYPE_LABEL } from "@/lib/services/meetings";
import { signedFileUrl } from "@/lib/storage/signed-url";
import { toParagraphs } from "@/lib/minutes-text";
import { dateColumnToString, formatKoreanDate, cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Badge, DemoBadge } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { UploadMinutesDialog } from "@/components/minutes/upload-dialog";
import { StatusPoller } from "@/components/minutes/status-poller";
import { ReextractButton } from "@/components/minutes/reextract-button";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "summary", label: "정리본" },
  { key: "original", label: "원문" },
  { key: "proposals", label: "AI 제안" },
  { key: "files", label: "파일" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const METHOD_LABEL: Record<string, string> = {
  pdf_text: "PDF 텍스트", docx: "DOCX", hwpx: "HWPX", hwp_best_effort: "HWP(최선 노력)", plain: "텍스트 파일", paste: "붙여넣기",
};

function statusTone(status: string) {
  if (status === "failed") return "border border-danger/30 bg-[#FBEAEA] text-danger";
  if (status === "uploaded" || status === "extracting" || status === "analyzing") return "bg-[#EEF3F8] text-info";
  return "";
}

type SP = { q?: string; from?: string; to?: string; type?: string; id?: string; tab?: string };

export default async function MinutesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const settings = await getPermissionSettings(prisma, user.termId);
  const canUpload = can(user, { type: "meeting.upload" }, settings);
  const canReextract = can(user, { type: "meeting.reanalyze" }, settings);
  const maxMb = Number(process.env.UPLOAD_MAX_MB ?? 50);

  const meetings = await listMeetings(prisma, user.termId, sp);
  const selectedId = sp.id ?? meetings[0]?.id;
  const detail = selectedId ? await getMeetingDetail(prisma, user.termId, selectedId) : null;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "original";

  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/minutes?${p.toString()}`;
  };
  const file = detail?.files[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">회의록</h1>
        {canUpload ? (
          <UploadMinutesDialog maxMb={maxMb} trigger={<Button><FileText className="h-4 w-4" /> 회의록 올리기</Button>} />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-4">
          <form method="get" action="/minutes" className="mb-3 space-y-2" aria-label="회의록 검색">
            <Input name="q" placeholder="제목 검색" defaultValue={sp.q} aria-label="제목 검색" />
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" name="from" defaultValue={sp.from} aria-label="시작일" />
              <Input type="date" name="to" defaultValue={sp.to} aria-label="종료일" />
            </div>
            <div className="flex gap-2">
              <Select name="type" defaultValue={sp.type ?? ""} aria-label="회의 유형">
                <option value="">모든 유형</option>
                {Object.entries(MEETING_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Button type="submit" variant="secondary" className="shrink-0 whitespace-nowrap">검색</Button>
            </div>
          </form>
          {meetings.length === 0 ? (
            <EmptyState
              title={sp.q || sp.from || sp.to || sp.type ? "조건에 맞는 회의록이 없습니다" : "아직 회의록이 없습니다"}
              description={canUpload ? "회의록 파일을 올리거나 내용을 붙여넣어 시작하세요." : "국장 이상이 회의록을 올릴 수 있습니다."}
            />
          ) : (
            <ul className="divide-y divide-border" aria-label="회의록 목록">
              {meetings.map((m) => (
                <li key={m.id}>
                  <Link
                    href={qs({ id: m.id, tab: undefined })}
                    aria-current={m.id === selectedId ? "page" : undefined}
                    className={cn("flex items-start justify-between gap-2 rounded-md px-2 py-2.5 hover:bg-bg", m.id === selectedId && "bg-bg")}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{m.title}</span>
                      <span className="tabular text-xs text-muted">
                        {formatKoreanDate(dateColumnToString(m.meeting_date))} · {MEETING_TYPE_LABEL[m.meeting_type as keyof typeof MEETING_TYPE_LABEL]}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {m.is_demo ? <DemoBadge /> : null}
                      <Badge className={statusTone(m.status)}>{MEETING_STATUS_LABEL[m.status] ?? m.status}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-8">
          {!detail ? (
            <EmptyState title="회의록을 선택하세요" />
          ) : (
            <article aria-label="회의록 상세">
              <StatusPoller meetingId={detail.id} status={detail.status} />
              <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">{detail.title}</h2>
                  <p className="tabular text-sm text-muted">
                    {formatKoreanDate(dateColumnToString(detail.meeting_date))} · {MEETING_TYPE_LABEL[detail.meeting_type as keyof typeof MEETING_TYPE_LABEL]} · 올린 사람 {detail.uploader.display_name}
                  </p>
                </div>
                <Badge className={statusTone(detail.status)}>
                  <span data-testid="meeting-status">{MEETING_STATUS_LABEL[detail.status] ?? detail.status}</span>
                </Badge>
              </header>

              {detail.status === "uploaded" || detail.status === "extracting" ? (
                <p className="mb-4 flex items-center gap-2 rounded-lg bg-[#EEF3F8] px-3 py-2 text-sm text-info" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" /> 글자를 추출하고 있습니다…
                </p>
              ) : null}
              {detail.status === "failed" ? (
                <div className="mb-4 flex flex-wrap items-start justify-between gap-2 rounded-lg border border-danger/30 bg-[#FBEAEA] px-3 py-2" role="alert">
                  <p className="flex items-start gap-2 text-sm text-danger">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span data-testid="extraction-error">{file?.extraction_error ?? "텍스트를 추출하지 못했습니다."}</span>
                  </p>
                  <span className="flex gap-2">
                    {canReextract ? <ReextractButton meetingId={detail.id} /> : null}
                    {canUpload ? <UploadMinutesDialog maxMb={maxMb} trigger={<Button size="sm">파일 다시 올리기</Button>} /> : null}
                  </span>
                </div>
              ) : null}

              <nav role="tablist" aria-label="회의록 보기" className="mb-4 flex gap-1 border-b border-border">
                {TABS.map((t) => (
                  <Link
                    key={t.key}
                    role="tab"
                    aria-selected={tab === t.key}
                    href={qs({ id: detail.id, tab: t.key })}
                    className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t.key ? "border-text font-semibold" : "border-transparent text-muted hover:text-text")}
                  >
                    {t.label}
                  </Link>
                ))}
              </nav>

              {tab === "summary" ? (
                <EmptyState title="AI 정리본은 Phase 5에서 제공됩니다" description="회의록을 분석해 결정사항·액션아이템·일정·예산을 원문 위치와 함께 정리합니다." />
              ) : null}
              {tab === "proposals" ? (
                <EmptyState title="AI 제안은 Phase 5에서 제공됩니다" description="이 회의록에서 나온 사업·업무 제안과 처리 상태가 여기에 표시됩니다." />
              ) : null}
              {tab === "original" ? (
                file?.extracted_text ? (
                  <ol className="space-y-0.5 text-sm leading-relaxed" aria-label="원문" data-testid="original-text">
                    {toParagraphs(file.extracted_text).map((p) => (
                      <li key={p.n} id={`p-${p.n}`} className="grid grid-cols-[2.5rem_1fr] gap-2 rounded px-1 target:bg-[#FFF4D6]">
                        <span className="tabular select-none text-right text-xs leading-6 text-muted">{p.n}</span>
                        <span className="whitespace-pre-wrap break-words">{p.text}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <EmptyState title={detail.status === "failed" ? "추출된 원문이 없습니다" : "추출이 끝나면 원문이 표시됩니다"} />
                )
              ) : null}
              {tab === "files" ? (
                file ? (
                  <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
                    <dt className="text-muted">파일명</dt><dd className="break-all">{file.original_name}</dd>
                    <dt className="text-muted">크기</dt><dd className="tabular">{file.size ? `${(Number(file.size) / 1024).toFixed(1)}KB` : "-"}</dd>
                    <dt className="text-muted">추출 방식</dt><dd>{file.extraction_method ? METHOD_LABEL[file.extraction_method] ?? file.extraction_method : "-"}</dd>
                    <dt className="text-muted">SHA-256</dt><dd className="tabular break-all text-xs">{file.sha256}</dd>
                    <dt className="text-muted">원본</dt>
                    <dd>
                      {file.storage_key ? (
                        <a className="inline-flex items-center gap-1 underline" href={signedFileUrl(file.storage_key, { download: true })} data-testid="download-original">
                          <Download className="h-4 w-4" /> 내려받기
                        </a>
                      ) : "-"}
                      <span className="ml-2 text-xs text-muted">(링크는 10분간 유효)</span>
                    </dd>
                  </dl>
                ) : (
                  <EmptyState title="파일이 없습니다" />
                )
              ) : null}
            </article>
          )}
        </Card>
      </div>
    </div>
  );
}
