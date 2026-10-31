"use client";

import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, Select } from "@/components/ui/field";
import { api } from "@/lib/client-api";

export type ProjectFormValues = {
  id?: string;
  title: string;
  category: string;
  event_start: string;
  event_end: string;
  venue: string;
  expected_beneficiaries: string;
  host: string;
  organizer: string;
  uses_external_vendor: boolean;
  school: string; // 교비 계획액(빈 값이면 재원 아님)
  student_fee: string;
};

const EMPTY: ProjectFormValues = {
  title: "", category: "event", event_start: "", event_end: "", venue: "", expected_beneficiaries: "", host: "", organizer: "",
  uses_external_vendor: false, school: "", student_fee: "",
};

const CATEGORIES = [["event", "행사"], ["promotion", "홍보"], ["partnership", "제휴"], ["welfare", "복지"], ["admin", "행정"], ["other", "기타"]];

/** 사업 만들기·수정 (8-5) */
export function ProjectFormDialog({ trigger, initial }: { trigger: React.ReactNode; initial?: ProjectFormValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const v = initial ?? EMPTY;
  const editing = Boolean(v.id);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    const funding = (["school", "student_fee"] as const)
      .filter((k) => fd.get(`use_${k}`) === "on")
      .map((k) => ({ source: k, amount_planned: Number(s(k) || 0) }));
    const body = {
      title: s("title"), category: s("category"), event_start: s("event_start"), event_end: s("event_end"), venue: s("venue"),
      expected_beneficiaries: s("expected_beneficiaries"), host: s("host"), organizer: s("organizer"),
      uses_external_vendor: fd.get("uses_external_vendor") === "on", funding,
    };
    setPending(true);
    setError(null);
    try {
      if (editing) {
        await api(`/api/projects/${v.id}`, { method: "PATCH", body });
        setOpen(false);
        router.refresh();
      } else {
        const r = await api<{ id: string }>("/api/projects", { body });
        setOpen(false);
        router.push(`/projects/${r.id}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl focus:outline-none">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">{editing ? "사업 정보 수정" : "사업 만들기"}</Dialog.Title>
            <Dialog.Close className="rounded-md p-1 hover:bg-bg" aria-label="닫기"><X className="h-5 w-5" /></Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">사업 기본 정보를 입력합니다.</Dialog.Description>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
              <div><Label htmlFor="p-title">사업명</Label><Input id="p-title" name="title" required maxLength={150} defaultValue={v.title} /></div>
              <div>
                <Label htmlFor="p-cat">분류</Label>
                <Select id="p-cat" name="category" defaultValue={v.category}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="p-start">행사 시작일</Label><Input id="p-start" name="event_start" type="date" defaultValue={v.event_start} /></div>
              <div><Label htmlFor="p-end">행사 종료일 (비우면 시작일)</Label><Input id="p-end" name="event_end" type="date" defaultValue={v.event_end} /></div>
              <div><Label htmlFor="p-venue">장소</Label><Input id="p-venue" name="venue" maxLength={150} defaultValue={v.venue} /></div>
              <div><Label htmlFor="p-ben">예상 수혜 인원</Label><Input id="p-ben" name="expected_beneficiaries" type="number" min={0} defaultValue={v.expected_beneficiaries} /></div>
              <div><Label htmlFor="p-host">주최</Label><Input id="p-host" name="host" maxLength={100} defaultValue={v.host} /></div>
              <div><Label htmlFor="p-org">주관</Label><Input id="p-org" name="organizer" maxLength={100} defaultValue={v.organizer} /></div>
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">재원 (둘 다 고를 수 있음)</legend>
              {([["school", "교비", v.school], ["student_fee", "학생회비", v.student_fee]] as const).map(([k, l, amt]) => (
                <div key={k} className="flex items-center gap-3">
                  <label className="flex w-24 items-center gap-1.5 text-sm"><input type="checkbox" name={`use_${k}`} defaultChecked={amt !== ""} /> {l}</label>
                  <Input name={k} type="number" min={0} step={1000} placeholder="계획 금액(원)" aria-label={`${l} 계획 금액`} defaultValue={amt} className="w-48" />
                </div>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="uses_external_vendor" defaultChecked={v.uses_external_vendor} /> 외부업체·대행사 이용</label>
            <FormMessage>{error}</FormMessage>
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild><Button type="button" variant="secondary">취소</Button></Dialog.Close>
              <Button type="submit" disabled={pending}>{pending ? "저장 중…" : editing ? "저장" : "사업 만들기"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
