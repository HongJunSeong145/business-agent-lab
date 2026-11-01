"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import type { A1Summary } from "@/lib/ai/schemas/a1";
import { DEPARTMENTS } from "@/lib/design/tokens";

type Ref = { para: number; quote: string; grounded?: boolean };

function Src({ r, meetingId }: { r: Ref; meetingId: string }) {
  return (
    <a href={`/minutes?id=${meetingId}&tab=original#p-${r.para}`} className="ml-1 whitespace-nowrap text-xs text-muted underline" title={r.quote}>
      원문 ¶{r.para}{r.grounded === false ? " (확인 필요)" : ""}
    </a>
  );
}

const LIST_LABEL = { decisions: "결정사항", discussions: "논의사항", pending: "보류사항" } as const;

/** 회의록 정리본 (8-3): A1 결과 — 각 항목의 '원문 보기'는 원문 탭의 해당 문단으로 이동·강조. 편집하면 새 버전 저장 */
export function SummaryView({ meetingId, summary, version, model, canEdit }: { meetingId: string; summary: A1Summary; version: number; model: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<A1Summary>(summary);
  const [saving, setSaving] = useState(false);
  const s = editing ? draft : summary;

  const setAgendaList = (ai: number, key: keyof typeof LIST_LABEL, list: A1Summary["agenda"][number]["decisions"]) =>
    setDraft({ ...draft, agenda: draft.agenda.map((a, i) => (i === ai ? { ...a, [key]: list } : a)) });

  return (
    <div className="space-y-5" data-testid="summary">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>정리본 v{version} · {model === "user-edit" ? "사용자 편집본" : `AI(${model ?? "-"})`}</span>
        {canEdit ? (
          editing ? (
            <span className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => (setDraft(summary), setEditing(false))}>취소</Button>
              <Button
                size="sm"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const r = await api<{ version: number }>(`/api/meetings/${meetingId}/analysis`, { method: "PUT", body: { summary: draft } });
                    toast(`정리본을 v${r.version}로 저장했습니다.`);
                    setEditing(false);
                    router.refresh();
                  } catch (e) {
                    toast((e as Error).message, { tone: "error" });
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                새 버전으로 저장
              </Button>
            </span>
          ) : (
            <span className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>정리본 편집</Button>
              <Button
                size="sm"
                variant="secondary"
                title="고친 정리본으로 업무 제안만 다시 만듭니다(전체 재분석보다 비용이 적음). 이미 승인한 업무는 다시 제안하지 않습니다."
                onClick={async () => {
                  if (!window.confirm("이 정리본으로 업무 제안을 다시 만들까요?\n아직 처리하지 않은 제안은 새 제안으로 바뀝니다. 이미 승인해 만든 업무는 그대로입니다.")) return;
                  try {
                    await api(`/api/meetings/${meetingId}/repropose`, { method: "POST" });
                    toast("정리본으로 업무 제안을 다시 만드는 중입니다. 끝나면 검토 대기에 올라옵니다.");
                    router.refresh();
                  } catch (e) {
                    toast((e as Error).message, { tone: "error" });
                  }
                }}
              >
                이 정리본으로 제안 다시 만들기
              </Button>
            </span>
          )
        ) : null}
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold">안건별 정리</h3>
        {s.agenda.length === 0 ? <p className="text-sm text-muted">안건을 찾지 못했습니다.</p> : null}
        <ol className="space-y-3">
          {s.agenda.map((a, ai) => (
            <li key={ai} className="rounded-lg border border-border p-3">
              <p className="font-medium">{a.title}<Src r={{ para: a.para, quote: a.title }} meetingId={meetingId} /></p>
              {(Object.keys(LIST_LABEL) as (keyof typeof LIST_LABEL)[]).map((key) =>
                a[key].length || editing ? (
                  <div key={key} className="mt-2">
                    <p className="text-xs font-semibold text-muted">{LIST_LABEL[key]}</p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {a[key].map((it, ii) => (
                        <li key={ii} className="flex items-start gap-1">
                          <span aria-hidden>·</span>
                          {editing ? (
                            <>
                              <input aria-label={`${LIST_LABEL[key]} 편집`} className="flex-1 rounded border border-border px-1" value={it.text} onChange={(e) => setAgendaList(ai, key, a[key].map((x, j) => (j === ii ? { ...x, text: e.target.value } : x)))} />
                              <button aria-label="항목 삭제" onClick={() => setAgendaList(ai, key, a[key].filter((_, j) => j !== ii))}><X className="h-3.5 w-3.5" /></button>
                            </>
                          ) : (
                            <span>{it.text}<Src r={it} meetingId={meetingId} /></span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {editing ? (
                      <button className="mt-1 inline-flex items-center gap-1 text-xs underline" onClick={() => setAgendaList(ai, key, [...a[key], { text: "새 항목", para: a.para, quote: "" }])}>
                        <Plus className="h-3 w-3" /> {LIST_LABEL[key]} 추가
                      </button>
                    ) : null}
                  </div>
                ) : null,
              )}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">액션아이템</h3>
        {s.action_items.length === 0 ? <p className="text-sm text-muted">없음</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm" data-testid="action-items">
            <thead className="text-xs text-muted"><tr><th className="py-1 pr-2 font-medium">누가</th><th className="py-1 pr-2 font-medium">무엇을</th><th className="py-1 pr-2 font-medium">언제</th><th /></tr></thead>
            <tbody className="divide-y divide-border">
              {s.action_items.map((x, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-2">{x.department ? DEPARTMENTS[x.department].nameKo : x.who ?? "-"}</td>
                  <td className="py-1.5 pr-2">
                    {editing ? (
                      <input aria-label="액션아이템 편집" className="w-full rounded border border-border px-1" value={x.what} onChange={(e) => setDraft({ ...draft, action_items: draft.action_items.map((y, j) => (j === i ? { ...y, what: e.target.value } : y)) })} />
                    ) : x.what}
                  </td>
                  <td className="tabular py-1.5 pr-2 whitespace-nowrap">
                    {x.due_date ?? x.due_text ?? "-"}
                    {x.date_confidence === "low" && x.due_date ? <span className="ml-1 text-xs text-warning-text" title="상대 표현을 회의일 기준으로 해석">추정</span> : null}
                  </td>
                  <td className="py-1.5"><Src r={x} meetingId={meetingId} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold">언급된 일정</h3>
          <ul className="space-y-1 text-sm">
            {s.mentioned_dates.length === 0 ? <li className="text-muted">없음</li> : null}
            {s.mentioned_dates.map((d, i) => <li key={i}><span className="tabular">{d.date ?? "날짜 미상"}</span> · {d.text}<Src r={d} meetingId={meetingId} /></li>)}
          </ul>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">예산·금액</h3>
          <ul className="space-y-1 text-sm">
            {s.budget.length === 0 ? <li className="text-muted">없음</li> : null}
            {s.budget.map((b, i) => <li key={i}>{b.amount !== null ? `${b.amount.toLocaleString()}원 · ` : ""}{b.item}<Src r={b} meetingId={meetingId} /></li>)}
          </ul>
        </section>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold">사업 후보</h3>
        <ul className="space-y-1 text-sm">
          {s.events.length === 0 ? <li className="text-muted">없음</li> : null}
          {s.events.map((e, i) => (
            <li key={i}>
              <strong>{e.title}</strong> · {e.date ?? "날짜 미정"}{e.venue ? ` · ${e.venue}` : ""}{e.beneficiaries !== null ? ` · ${e.beneficiaries}명` : ""}
              {e.funding.length ? ` · ${e.funding.map((f) => (f === "school" ? "교비" : "학생회비")).join("·")}` : ""}
              <Src r={e} meetingId={meetingId} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
