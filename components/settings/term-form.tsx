"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";

export type TermValues = {
  council_name: string; university: string; college: string; term_number: number; name: string; banner_title: string; banner_subtitle: string;
  q1_start: string; q1_end: string; q2_start: string; q2_end: string; q3_start: string; q3_end: string; q4_start: string; q4_end: string;
};

const Q = [1, 2, 3, 4] as const;
const Q_DESC: Record<number, string> = { 1: "중앙선거 종료 ~ 1학기 개강 전날", 2: "1학기 개강 ~ 종강", 3: "여름방학", 4: "2학기 개강 ~ 다음 선거 확정" };

/** 기수·분기 설정 (D5, 8-11): 학사일정을 넣으면 분기를 자동 계산하고, 저장 전에 고칠 수 있다 */
export function TermForm({ initial }: { initial: TermValues }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [cal, setCal] = useState({ electionEnd: "", sem1Start: "", sem1End: "", sem2Start: "", nextElectionEnd: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (k: keyof TermValues) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: k === "term_number" ? Number(e.target.value) : e.target.value });

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor="council_name">학생회 이름</Label><Input id="council_name" value={v.council_name} onChange={set("council_name")} /></div>
        <div><Label htmlFor="university">대학</Label><Input id="university" value={v.university} onChange={set("university")} /></div>
        <div><Label htmlFor="college">단과대학</Label><Input id="college" value={v.college} onChange={set("college")} /></div>
        <div><Label htmlFor="term_number">제N대</Label><Input id="term_number" type="number" min={1} value={v.term_number} onChange={set("term_number")} /></div>
        <div><Label htmlFor="term_name">기수 이름(선택)</Label><Input id="term_name" value={v.name} onChange={set("name")} /></div>
        <div />
        <div className="sm:col-span-1"><Label htmlFor="banner_title">배너 제목</Label><Input id="banner_title" value={v.banner_title} onChange={set("banner_title")} placeholder="예) 제7대 ○○ 학생회" /></div>
        <div className="sm:col-span-2"><Label htmlFor="banner_subtitle">배너 보조 문구</Label><Input id="banner_subtitle" value={v.banner_subtitle} onChange={set("banner_subtitle")} /></div>
      </section>

      <section className="rounded-lg border border-border p-4">
        <h3 className="mb-1 text-sm font-semibold">학사일정으로 분기 자동 계산</h3>
        <p className="mb-3 text-xs text-muted">아래 날짜를 넣고 “분기 계산”을 누르면 분기 날짜가 채워집니다. 저장 전에 직접 고칠 수 있습니다.</p>
        <div className="grid gap-3 sm:grid-cols-5">
          {([["electionEnd", "중앙선거 종료(당선 확정)"], ["sem1Start", "1학기 개강"], ["sem1End", "1학기 종강"], ["sem2Start", "2학기 개강"], ["nextElectionEnd", "다음 선거 확정"]] as const).map(([k, l]) => (
            <div key={k}><Label htmlFor={k}>{l}</Label><Input id={k} type="date" value={cal[k]} onChange={(e) => setCal({ ...cal, [k]: e.target.value })} /></div>
          ))}
        </div>
        <Button
          className="mt-3"
          size="sm"
          variant="secondary"
          onClick={async () => {
            setError(null);
            try {
              const q = await api<Record<string, string>>("/api/settings/quarters-preview", { body: cal });
              setV({ ...v, ...q });
              toast("분기 날짜를 계산했습니다. 확인 후 저장하세요.");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          분기 계산
        </Button>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {Q.map((n) => (
          <fieldset key={n} className="rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold">{n}분기 <span className="font-normal text-muted">· {Q_DESC[n]}</span></legend>
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor={`q${n}_start`}>시작</Label><Input id={`q${n}_start`} type="date" value={v[`q${n}_start`]} onChange={set(`q${n}_start`)} /></div>
              <div><Label htmlFor={`q${n}_end`}>끝</Label><Input id={`q${n}_end`} type="date" value={v[`q${n}_end`]} onChange={set(`q${n}_end`)} /></div>
            </div>
          </fieldset>
        ))}
      </section>
      <p className="text-xs text-muted">예결산 심사 묶음: 1·2분기 함께, 3·4분기 함께. 분기를 바꾸면 사업의 분기 귀속이 다시 계산됩니다.</p>

      <FormMessage>{error}</FormMessage>
      <Button
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            await api("/api/settings/term", { method: "PUT", body: v });
            toast("기수 설정을 저장했습니다.");
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "저장 중…" : "저장"}
      </Button>
    </div>
  );
}
