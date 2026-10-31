"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

export type Options = {
  departments: { id: string; code: string; name_ko: string }[];
  members: { id: string; name: string; dept: string | null }[];
  projects: { id: string; title: string }[];
  tasks: { id: string; title: string; project: string | null }[];
};

/** 폼 선택지(국서·회원·사업·업무) — 열릴 때 한 번 불러온다 */
export function useOptions(enabled: boolean) {
  const [data, setData] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api<Options>("/api/options")
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return { data, error };
}
