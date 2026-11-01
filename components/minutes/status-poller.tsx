"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** 추출이 끝날 때까지 2초마다 상태를 확인하고, 바뀌면 화면을 새로 그린다 */
export function StatusPoller({ meetingId, status, expectAnalysis = false }: { meetingId: string; status: string; expectAnalysis?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const active = status === "uploaded" || status === "extracting" || status === "analyzing";
    if (!active && !expectAnalysis) return;
    let ticks = 0;
    const t = setInterval(async () => {
      // '추출 완료' 상태에서 분석 시작을 기다릴 때는 최대 30초만
      if (!active && ++ticks > 15) return clearInterval(t);
      const r = await fetch(`/api/meetings/${meetingId}/status`, { cache: "no-store" }).catch(() => null);
      if (!r?.ok) return;
      const { status: next } = (await r.json()) as { status: string };
      if (next !== status) router.refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [meetingId, status, expectAnalysis, router]);
  return null;
}
