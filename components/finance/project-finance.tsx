"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type Ev = { id: string; name: string; note: string | null; by: string | null; at: string; verified: boolean; verifiedBy: string | null; preview: string; url: string; downloadUrl: string; canDelete: boolean };
type Data = {
  canEdit: boolean; canUpload: boolean; studentFee: boolean; rosterRequired: boolean; leader: boolean;
  requirements: { id: string; type: string; label: string; required: boolean; due: string | null; met: boolean; items: Ev[] }[];
  purchases: { id: string; name: string; qty: number; unitPrice: number; amount: number; vendor: string | null; funding: string | null; status: string; purchasedAt: string | null; receiptMissing: boolean; evidence: Ev[] }[];
};
const STATUS: Record<string, string> = { listed: "목록", approved: "승인", purchased: "구입 완료", cancelled: "취소" };
const won = (n: number) => `${n.toLocaleString()}원`;
const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.hwpx,.hwp,.txt,.md";

async function postEvidence(projectId: string, fd: FormData) {
  const res = await fetch(`/api/projects/${projectId}/finance/evidence`, { method: "POST", body: fd });
  const b = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(b.error ?? "올리지 못했습니다.");
}

function UploadButton({ projectId, target, label, onDone }: { projectId: string; target: { requirementId?: string; purchaseItemId?: string }; label: string; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-bg", busy && "opacity-50")}>
      <Upload className="h-3 w-3" />{busy ? "올리는 중…" : "증빙 올리기"}
      <input
        type="file"
        accept={ACCEPT}
        className="sr-only"
        aria-label={label}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const fd = new FormData();
          fd.set("file", f);
          if (target.requirementId) fd.set("requirementId", target.requirementId);
          if (target.purchaseItemId) fd.set("purchaseItemId", target.purchaseItemId);
          setBusy(true);
          try {
            await postEvidence(projectId, fd);
            toast("증빙을 올렸습니다.");
            await onDone();
          } catch (err) {
            toast((err as Error).message, { tone: "error" });
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

function EvidenceList({ items, canVerify, onChanged }: { items: Ev[]; canVerify: boolean; onChanged: () => Promise<void> }) {
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      await onChanged();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    }
  };
  if (!items.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {items.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center gap-2">
          <a href={i.downloadUrl} className="inline-flex items-center gap-1 underline"><Download className="h-3 w-3" />{i.name}</a>
          <span className="text-muted">{i.by}</span>
          {i.verified ? <span className="inline-flex items-center gap-0.5 text-success"><CheckCircle2 className="h-3 w-3" />검수 {i.verifiedBy}</span> : <span className="text-muted">미검수</span>}
          {canVerify ? <button className="underline" onClick={() => void act(() => api(`/api/evidence/${i.id}`, { method: "PATCH", body: { verified: !i.verified } }), i.verified ? "검수를 취소했습니다." : "검수했습니다.")}>{i.verified ? "검수 취소" : "검수"}</button> : null}
          {i.canDelete ? <button aria-label={`증빙 삭제: ${i.name}`} className="text-muted hover:text-danger" onClick={() => window.confirm("이 증빙을 삭제할까요?") && void act(() => api(`/api/evidence/${i.id}`, { method: "DELETE" }), "삭제했습니다.")}><Trash2 className="h-3 w-3" /></button> : null}
        </li>
      ))}
    </ul>
  );
}

/** 사업 상세 › 재정: 증빙 체크리스트(충족/누락) + 구입 리스트 (8-5, 8-8) */
export function ProjectFinancePanel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setD(await api<Data>(`/api/projects/${projectId}/finance`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);
  useEffect(() => {
    let c = false;
    api<Data>(`/api/projects/${projectId}/finance`).then((r) => !c && setD(r)).catch((e: Error) => !c && setError(e.message));
    return () => {
      c = true;
    };
  }, [projectId]);
  const changed = async () => {
    await load();
    router.refresh();
  };
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!d) return <div className="h-20 animate-pulse rounded-lg bg-bg" aria-busy="true" />;
  const total = d.purchases.filter((p) => p.status !== "cancelled").reduce((n, p) => n + p.amount, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="project-finance">
      <section aria-label="증빙 체크리스트">
        <h3 className="mb-2 text-sm font-semibold">증빙 체크리스트</h3>
        {d.requirements.length === 0 ? <p className="text-sm text-muted">재원을 정하면 규칙에 따라 표시됩니다.</p> : null}
        <ul className="space-y-2">
          {d.requirements.map((r) => (
            <li key={r.id} className="rounded-lg border border-border p-2 text-sm" data-evidence={r.type}>
              <div className="flex flex-wrap items-center gap-2">
                {r.met ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="충족" /> : <AlertTriangle className={cn("h-4 w-4", r.required ? "text-warning-text" : "text-muted")} aria-label="누락" />}
                <span className="font-medium">{r.label}</span>
                <span className="text-xs text-muted">{r.required ? "필수" : "권장"}{r.due ? ` · ~${r.due}` : ""}{r.met ? " · 충족" : " · 누락"}</span>
                {d.canUpload && r.type !== "receipt" && r.type !== "transfer_record" ? <span className="ml-auto"><UploadButton projectId={projectId} target={{ requirementId: r.id }} label={`${r.label} 증빙 파일`} onDone={changed} /></span> : null}
              </div>
              <EvidenceList items={r.items} canVerify={d.canEdit} onChanged={changed} />
              {r.type === "receipt" || r.type === "transfer_record" ? <p className="mt-1 text-xs text-muted">구입 리스트의 각 항목에서 올립니다.</p> : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="구입 리스트">
        <h3 className="mb-2 text-sm font-semibold">구입 리스트 <span className="font-normal text-muted">합계 {won(total)}</span></h3>
        <ul className="space-y-2">
          {d.purchases.length === 0 ? <li className="text-sm text-muted">아직 없습니다.</li> : null}
          {d.purchases.map((p) => (
            <li key={p.id} className={cn("rounded-lg border p-2 text-sm", p.receiptMissing ? "border-warning" : "border-border")} data-purchase={p.name}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("font-medium", p.status === "cancelled" && "text-muted line-through")}>{p.name}</span>
                <span className="tabular text-xs text-muted">{p.qty}개 × {won(p.unitPrice)} = {won(p.amount)}{p.vendor ? ` · ${p.vendor}` : ""}{p.funding ? ` · ${p.funding === "school" ? "교비" : "학생회비"}` : ""}</span>
                {d.canEdit ? (
                  <Select aria-label={`${p.name} 상태`} className="ml-auto h-7 w-28 text-xs" value={p.status} onChange={async (e) => {
                    try {
                      await api(`/api/purchases/${p.id}`, { method: "PATCH", body: { status: e.target.value } });
                      await changed();
                    } catch (err) {
                      toast((err as Error).message, { tone: "error" });
                    }
                  }}>
                    {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                ) : (
                  <span className="ml-auto text-xs">{STATUS[p.status]}</span>
                )}
              </div>
              {p.receiptMissing ? <p className="mt-1 text-xs text-warning-text" role="status">영수증·이체내역이 없습니다</p> : null}
              {p.status === "purchased" && d.canUpload ? <div className="mt-1"><UploadButton projectId={projectId} target={{ purchaseItemId: p.id }} label={`${p.name} 영수증 파일`} onDone={changed} /></div> : null}
              <EvidenceList items={p.evidence} canVerify={d.canEdit} onChanged={changed} />
            </li>
          ))}
        </ul>
        {d.canEdit ? (
          <form
            aria-label="구입 항목 추가"
            className="mt-2 flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = e.currentTarget;
              const fd = Object.fromEntries(new FormData(f)) as Record<string, string>;
              try {
                await api(`/api/projects/${projectId}/finance/purchases`, { body: { ...fd, funding_source: fd.funding_source || null } });
                f.reset();
                toast("구입 항목을 추가했습니다.");
                await changed();
              } catch (err) {
                toast((err as Error).message, { tone: "error" });
              }
            }}
          >
            <Input name="name" required placeholder="품목" aria-label="품목" className="h-8 w-32" />
            <Input name="qty" type="number" min={1} defaultValue={1} aria-label="수량" className="h-8 w-16" />
            <Input name="unit_price" type="number" min={0} required placeholder="단가" aria-label="단가" className="h-8 w-24" />
            <Input name="vendor" placeholder="구입처" aria-label="구입처" className="h-8 w-24" />
            <Select name="funding_source" aria-label="구입 재원" className="h-8 w-28">
              <option value="">재원</option><option value="student_fee">학생회비</option><option value="school">교비</option>
            </Select>
            <Button size="sm" variant="secondary">추가</Button>
          </form>
        ) : null}
      </section>
    </div>
  );
}

type Lead = { id: string; company_name: string; website: string | null; contact_channel: string | null; status: string; last_contact_at: string | null; note: string | null };
const PSTATUS: Record<string, string> = { candidate: "후보", contacted: "문의함", replied: "회신", negotiating: "협의 중", confirmed: "확정", declined: "거절" };

/** 사업 상세 › 제휴 진행표 (사무국) */
export function PartnersPanel({ projectId }: { projectId: string }) {
  const [d, setD] = useState<{ canEdit: boolean; rows: Lead[] } | null>(null);
  const load = useCallback(async () => setD(await api(`/api/projects/${projectId}/partners`)), [projectId]);
  useEffect(() => {
    let c = false;
    api<{ canEdit: boolean; rows: Lead[] }>(`/api/projects/${projectId}/partners`).then((r) => !c && setD(r)).catch(() => undefined);
    return () => {
      c = true;
    };
  }, [projectId]);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    }
  };
  if (!d) return <div className="h-16 animate-pulse rounded-lg bg-bg" aria-busy="true" />;
  return (
    <div data-testid="partners">
      <table className="w-full text-left text-sm" aria-label="제휴 진행표">
        <thead className="text-xs text-muted"><tr><th className="py-1">업체</th><th>문의 채널</th><th>상태</th><th>마지막 연락</th><th>메모</th><th /></tr></thead>
        <tbody className="divide-y divide-border">
          {d.rows.length === 0 ? <tr><td colSpan={6} className="py-2 text-muted">아직 없습니다.</td></tr> : null}
          {d.rows.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5">{r.website ? <a href={r.website} target="_blank" rel="noopener noreferrer nofollow" className="underline">{r.company_name}</a> : r.company_name}</td>
              <td className="text-xs">{r.contact_channel}</td>
              <td>
                {d.canEdit ? (
                  <Select aria-label={`${r.company_name} 상태`} className="h-7 w-24 text-xs" value={r.status} onChange={(e) => void act(() => api(`/api/partners/${r.id}`, { method: "PATCH", body: { status: e.target.value } }))}>
                    {Object.entries(PSTATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                ) : PSTATUS[r.status]}
              </td>
              <td className="tabular text-xs">{r.last_contact_at ? new Date(r.last_contact_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "-"}</td>
              <td className="text-xs">{r.note}</td>
              <td>{d.canEdit ? <button aria-label={`제휴 후보 삭제: ${r.company_name}`} className="text-muted hover:text-danger" onClick={() => window.confirm("삭제할까요?") && void act(() => api(`/api/partners/${r.id}`, { method: "DELETE" }))}><Trash2 className="h-4 w-4" /></button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.canEdit ? (
        <form
          aria-label="제휴 후보 추가"
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const body = Object.fromEntries(new FormData(f));
            await act(() => api(`/api/projects/${projectId}/partners`, { body }));
            f.reset();
          }}
        >
          <Input name="company_name" required placeholder="업체명" aria-label="업체명" className="h-8 w-32" />
          <Input name="website" type="url" placeholder="https://" aria-label="웹사이트" className="h-8 w-40" />
          <Input name="contact_channel" placeholder="문의 채널(공식 이메일·폼)" aria-label="문의 채널" className="h-8 w-44" />
          <Input name="note" placeholder="메모" aria-label="제휴 메모" className="h-8 w-32" />
          <Button size="sm" variant="secondary">추가</Button>
        </form>
      ) : null}
    </div>
  );
}
