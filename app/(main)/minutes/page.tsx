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
import { AnalyzeButton } from "@/components/minutes/analyze-button";
import { SummaryView } from "@/components/minutes/summary-view";
import { aiAvailable } from "@/lib/ai/runtime";
import { latestAnalysisJob } from "@/lib/services/analysis";
import type { A1Summary } from "@/lib/ai/schemas/a1";

const PROPOSAL_STATUS: Record<string, string> = { pending: "검토 대기", approved: "승인", edited_approved: "수정 승인", rejected: "거절", superseded: "대체됨" };
const PROPOSAL_KIND: Record<string, string> = { new_project: "새 사업", update_project: "사업 변경", new_task: "새 업무", deadline: "마감 변경" };

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
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : detail?.analyses[0] ? "summary" : "original";

  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/minutes?${p.toString()}`;
  };
  const file = detail?.files[0];
  const ai = aiAvailable();
  const [job, proposals] = detail
    ? await Promise.all([
        latestAnalysisJob(prisma, detail.id),
        prisma.proposal.findMany({ where: { source_type: "meeting", source_id: detail.id, status: { not: "superseded" } }, orderBy: { created_at: "asc" } }),
      ])
    : [null, []];
  const analysis = detail?.analyses[0];
  const hasText = Boolean(file?.extracted_text);

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
              <StatusPoller
                meetingId={detail.id}
                status={detail.status}
                // 추출 직후 분석 작업이 막 시작되려는 순간에 화면을 열었을 때도 결과를 따라간다
                expectAnalysis={ai && hasText && !analysis && detail.status === "extracted" && (!job || job.status === "queued" || job.status === "running")}
              />
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
              {detail.status === "analyzing" ? (
                <p className="mb-4 flex items-center gap-2 rounded-lg bg-[#EEF3F8] px-3 py-2 text-sm text-info" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" /> AI가 회의록을 정리하고 사업·업무를 제안하는 중입니다…
                </p>
              ) : null}
              {hasText && detail.status !== "analyzing" && job && (job.status === "failed" || job.status === "waiting_budget") ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning bg-[#FFF8E6] px-3 py-2 text-sm" role="alert" data-testid="analysis-failed">
                  <span className="text-warning-text">
                    {job.status === "waiting_budget" ? "오늘 AI 예산을 모두 써서 분석이 내일 이어집니다." : "분석 실패 — 다시 시도해 주세요."}
                    {job.error?.startsWith("ai_unavailable") ? " (AI 연결 문제)" : job.error?.startsWith("output_invalid") ? " (AI 결과 형식 오류)" : ""}
                  </span>
                  {canReextract && ai ? <AnalyzeButton meetingId={detail.id} reanalyze={false} /> : null}
                </div>
              ) : null}
              {hasText && !ai ? (
                <p className="mb-4 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-muted" role="status" data-testid="ai-unavailable">
                  AI 일시 사용 불가 — 회의록 열람과 업무 직접 만들기는 그대로 쓸 수 있습니다.
                </p>
              ) : null}
              {hasText && ai && canReextract && detail.status !== "analyzing" && !(job && (job.status === "queued" || job.status === "running")) ? (
                <div className="mb-4 flex justify-end">
                  <AnalyzeButton meetingId={detail.id} reanalyze={Boolean(analysis)} />
                </div>
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
                analysis ? (
                  <SummaryView meetingId={detail.id} summary={analysis.summary as unknown as A1Summary} version={analysis.version} model={analysis.model} canEdit={canReextract} />
                ) : (
                  <EmptyState title="아직 정리본이 없습니다" description={ai ? "AI 분석이 끝나면 결정사항·액션아이템·일정·예산이 원문 위치와 함께 정리됩니다." : "AI를 쓸 수 없어 정리본이 없습니다. 원문 탭에서 회의록을 볼 수 있습니다."} />
                )
              ) : null}
              {tab === "proposals" ? (
                proposals.length === 0 ? (
                  <EmptyState title="이 회의록에서 나온 제안이 없습니다" />
                ) : (
                  <div className="space-y-2" data-testid="meeting-proposals">
                    {proposals.some((p) => p.status === "pending") ? (
                      <Link href="/review" className="inline-block text-sm underline">검토 화면에서 처리하기 →</Link>
                    ) : null}
                    <ul className="divide-y divide-border text-sm">
                      {proposals.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                          <span className="min-w-0 truncate">
                            <span className="mr-2 rounded bg-bg px-1.5 py-0.5 text-xs">{PROPOSAL_KIND[p.kind] ?? p.kind}</span>
                            {String((p.payload as { title?: string }).title ?? "")}
                            {p.inferred ? <span className="ml-1 text-xs text-warning-text">추론</span> : null}
                          </span>
                          <Badge className={p.status === "pending" ? "bg-[#EEF3F8] text-info" : ""}>{PROPOSAL_STATUS[p.status] ?? p.status}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
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
