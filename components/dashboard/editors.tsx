"use client";

import { Dialog } from "radix-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Card, CardTitle } from "@/components/ui/card";
import { DemoBadge } from "@/components/common/badges";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
      router.refresh();
      return true;
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

// ───────── 배너 ─────────
export function BannerEditor({ title, subtitle, hasImage }: { title: string; subtitle: string | null; hasImage: boolean }) {
  const [open, setOpen] = useState(false);
  const { run, busy } = useRun();
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="inline-flex h-8 items-center gap-1 rounded-lg bg-black/40 px-3 text-xs text-white hover:bg-black/60"><Pencil className="h-3.5 w-3.5" />배너 편집</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface p-5 shadow-xl">
          <Dialog.Title className="mb-3 text-base font-semibold">배너 편집</Dialog.Title>
          <Dialog.Description className="sr-only">배너 제목·부제·사진을 바꿉니다.</Dialog.Description>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const img = fd.get("image");
              if (!(img instanceof File) || img.size === 0) fd.delete("image");
              const ok = await run(async () => {
                const res = await fetch("/api/settings/banner", { method: "POST", body: fd });
                const b = (await res.json().catch(() => ({}))) as { error?: string };
                if (!res.ok) throw new Error(b.error ?? "저장하지 못했습니다.");
              }, "배너를 바꿨습니다.");
              if (ok) setOpen(false);
            }}
          >
            <div><Label htmlFor="b-title">제목</Label><Input id="b-title" name="title" defaultValue={title} maxLength={80} /></div>
            <div><Label htmlFor="b-sub">부제</Label><Input id="b-sub" name="subtitle" defaultValue={subtitle ?? ""} maxLength={120} /></div>
            <div><Label htmlFor="b-img">사진(PNG·JPG·WEBP, 5MB 이하)</Label><input id="b-img" name="image" type="file" accept=".png,.jpg,.jpeg,.webp,.gif" className="block w-full text-sm" /></div>
            {hasImage ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="removeImage" value="1" />사진 빼기</label> : null}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild><Button type="button" variant="secondary" size="sm">취소</Button></Dialog.Close>
              <Button type="submit" size="sm" disabled={busy}>저장</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ───────── 인적사항 ─────────
type Profile = { id: string; position_title: string | null; name: string; major: string | null; student_id: string | null; phone: string | null; gmail: string | null; school_email: string | null; is_demo: boolean; canEdit: boolean; canDelete: boolean };
const PCOLS: [keyof Profile, string, string][] = [["position_title", "직책", "w-24"], ["name", "이름", "w-24"], ["major", "학과", "w-36"], ["student_id", "학번", "w-28"], ["phone", "연락처", "w-32"], ["gmail", "G-mail", "w-44"], ["school_email", "학교메일", "w-44"]];

export function MemberDirectoryEditor({ rows, canCreate }: { rows: Profile[]; canCreate: boolean }) {
  const { run, busy } = useRun();
  const save = (id: string, k: string, v: string, prev: string | null) => {
    if (v === (prev ?? "")) return;
    void run(() => api(`/api/profiles/${id}`, { method: "PATCH", body: { [k]: v } }), "저장했습니다.");
  };
  return (
    <Card id="members" className="scroll-mt-20">
      <div className="mb-3 flex items-center justify-between">
        <CardTitle>학생회 인적사항</CardTitle>
        <span className="text-xs text-muted">{canCreate ? "칸을 고치면 바로 저장됩니다" : "내 정보만 고칠 수 있습니다"}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm" aria-label="학생회 인적사항">
          <thead className="border-b border-border text-xs text-muted">
            <tr>{PCOLS.map(([, h]) => <th key={h} className="px-1 py-2 font-medium">{h}</th>)}<th className="w-8" /></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((p) => (
              <tr key={p.id} data-profile-row={p.name}>
                {PCOLS.map(([k, h, w]) => (
                  <td key={k} className="px-1 py-1">
                    <input
                      aria-label={`${p.name} ${h}`}
                      defaultValue={(p[k] as string | null) ?? ""}
                      key={`${p.id}-${k}-${p[k] as string}`}
                      disabled={!p.canEdit}
                      title={p.canEdit ? undefined : "본인 또는 회장·국장만 고칠 수 있습니다"}
                      className={`${w} rounded border border-transparent bg-transparent px-1 py-1 enabled:hover:border-border enabled:focus:border-info disabled:text-text`}
                      onBlur={(e) => save(p.id, k, e.target.value.trim(), p[k] as string | null)}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    />
                    {k === "position_title" && p.is_demo ? <DemoBadge className="ml-1" /> : null}
                  </td>
                ))}
                <td>
                  {p.canDelete ? (
                    <button aria-label={`${p.name} 삭제`} className="text-muted hover:text-danger" onClick={() => window.confirm(`${p.name} 님의 인적사항을 삭제할까요?`) && void run(() => api(`/api/profiles/${p.id}`, { method: "DELETE" }), "삭제했습니다.")}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canCreate ? (
        <form
          className="mt-3 flex flex-wrap gap-2"
          aria-label="인적사항 추가"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const fd = Object.fromEntries(new FormData(f)) as Record<string, string>;
            if (await run(() => api("/api/profiles", { body: fd }), "추가했습니다.")) f.reset();
          }}
        >
          <Input name="position_title" placeholder="직책" aria-label="새 직책" className="h-8 w-24" />
          <Input name="name" placeholder="이름" aria-label="새 이름" required className="h-8 w-24" />
          <Input name="major" placeholder="학과" aria-label="새 학과" className="h-8 w-32" />
          <Button size="sm" variant="secondary" disabled={busy}><Plus className="h-4 w-4" />사람 추가</Button>
        </form>
      ) : null}
    </Card>
  );
}

// ───────── 외부 연락망 ─────────
type Contacts = {
  columns: { id: string; key: string; label: string }[];
  deletedColumns: { id: string; key: string; label: string }[];
  rows: { id: string; data: Record<string, string>; is_demo: boolean }[];
  canEditRows: boolean;
  canEditColumns: boolean;
};

export function ContactDirectoryEditor({ c }: { c: Contacts }) {
  const { run, busy } = useRun();
  const [newCol, setNewCol] = useState("");
  return (
    <Card id="contacts" className="scroll-mt-20">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <CardTitle>외부 연락망</CardTitle>
        {c.canEditColumns ? (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api("/api/contacts/columns", { body: { label: newCol } }), "열을 추가했습니다.")) setNewCol("");
            }}
          >
            <Input value={newCol} onChange={(e) => setNewCol(e.target.value)} placeholder="새 열 이름" aria-label="새 열 이름" required maxLength={30} className="h-8 w-32" />
            <Button size="sm" variant="secondary" disabled={busy}><Plus className="h-4 w-4" />열 추가</Button>
          </form>
        ) : null}
      </div>
      {c.deletedColumns.length && c.canEditColumns ? (
        <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          삭제한 열:
          {c.deletedColumns.map((d) => (
            <button key={d.id} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:bg-bg" aria-label={`열 되돌리기: ${d.label}`} onClick={() => void run(() => api(`/api/contacts/columns/${d.id}`, { method: "PATCH", body: { deleted: false } }), `'${d.label}' 열을 되돌렸습니다.`)}>
              <RotateCcw className="h-3 w-3" />{d.label}
            </button>
          ))}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm" aria-label="외부 연락망">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              {c.columns.map((col) => (
                <th key={col.id} className="px-1 py-2 font-medium">
                  {c.canEditColumns ? (
                    <span className="flex items-center gap-1">
                      <input
                        aria-label={`열 이름: ${col.label}`}
                        defaultValue={col.label}
                        key={col.label}
                        className="w-24 rounded border border-transparent bg-transparent px-1 font-medium hover:border-border"
                        onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== col.label && void run(() => api(`/api/contacts/columns/${col.id}`, { method: "PATCH", body: { label: e.target.value.trim() } }), "열 이름을 바꿨습니다.")}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      />
                      <button aria-label={`열 삭제: ${col.label}`} className="text-muted hover:text-danger" onClick={() => window.confirm(`'${col.label}' 열을 삭제할까요? 값은 보존되어 '되돌리기'로 복원할 수 있습니다.`) && void run(() => api(`/api/contacts/columns/${col.id}`, { method: "PATCH", body: { deleted: true } }), "열을 삭제했습니다.")}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {c.rows.map((r, ri) => (
              <tr key={r.id}>
                {c.columns.map((col, i) => (
                  <td key={col.id} className="px-1 py-1">
                    <input
                      aria-label={`연락처 ${ri + 1} ${col.label}`}
                      defaultValue={r.data[col.key] ?? ""}
                      key={`${r.id}-${col.key}-${r.data[col.key] ?? ""}`}
                      disabled={!c.canEditRows}
                      className="w-full min-w-20 rounded border border-transparent bg-transparent px-1 py-1 enabled:hover:border-border enabled:focus:border-info disabled:text-text"
                      onBlur={(e) => e.target.value.trim() !== (r.data[col.key] ?? "") && void run(() => api(`/api/contacts/rows/${r.id}`, { method: "PATCH", body: { data: { [col.key]: e.target.value.trim() } } }), "저장했습니다.")}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    />
                    {i === 0 && r.is_demo ? <DemoBadge className="ml-1" /> : null}
                  </td>
                ))}
                <td>
                  {c.canEditRows ? (
                    <button aria-label={`연락처 ${ri + 1} 삭제`} className="text-muted hover:text-danger" onClick={() => window.confirm("이 연락처를 삭제할까요?") && void run(() => api(`/api/contacts/rows/${r.id}`, { method: "DELETE" }), "삭제했습니다.")}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.canEditRows ? (
        <Button size="sm" variant="secondary" className="mt-3" disabled={busy} onClick={() => void run(() => api("/api/contacts/rows", { body: { data: {} } }), "빈 행을 추가했습니다.")}>
          <Plus className="h-4 w-4" />연락처 추가
        </Button>
      ) : null}
    </Card>
  );
}
