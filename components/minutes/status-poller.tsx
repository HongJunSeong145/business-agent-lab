"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** 추출이 끝날 때까지 2초마다 상태를 확인하고, 바뀌면 화면을 새로 그린다 */
export function StatusPoller({ meetingId, status }: { meetingId: string; status: string }) {
  const router = useRouter();
  useEffect(() => {
    if (status !== "uploaded" && status !== "extracting") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/meetings/${meetingId}/status`, { cache: "no-store" }).catch(() => null);
      if (!r?.ok) return;
      const { status: next } = (await r.json()) as { status: string };
      if (next !== status) router.refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [meetingId, status, router]);
  return null;
}
