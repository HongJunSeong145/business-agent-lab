"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** 다른 화면·다른 사람·AI 작업이 바꾼 내용을 열린 화면에 반영하라는 신호(업무 상세·레퍼런스·작업물 탭이 듣는다) */
export const LIVE_EVENT = "kgb:changed";
export function emitChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LIVE_EVENT));
}

/** 변경 신호를 받으면 fn 을 다시 부른다(업무 상세·탭의 데이터 다시 읽기) */
export function useLive(fn: () => void) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    const h = () => ref.current();
    window.addEventListener(LIVE_EVENT, h);
    return () => window.removeEventListener(LIVE_EVENT, h);
  }, []);
}

const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit"].includes((el as HTMLInputElement).type)) || el.isContentEditable);
};

/**
 * 실시간 반영: 몇 초마다 '변경 표시'만 확인하고, 바뀌었으면 화면 전체(진척도·캘린더·30일 일정·국서 공간·검토 대기 등)를 새로 그린다.
 * 입력 중이면 입력을 마칠 때까지 미룬다(쓰던 글이 지워지지 않게).
 */
export function LiveRefresh({ intervalMs = 8000 }: { intervalMs?: number }) {
  const router = useRouter();
  const last = useRef<string | null | undefined>(undefined);
  const pending = useRef(false);
  useEffect(() => {
    let stopped = false;
    const apply = () => {
      if (typing()) {
        pending.current = true;
        return;
      }
      pending.current = false;
      router.refresh();
      emitChanged();
    };
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/live", { cache: "no-store" });
        if (!r.ok) return;
        const { v } = (await r.json()) as { v: string | null };
        if (last.current !== undefined && v !== last.current) apply();
        last.current = v;
      } catch {
        /* 네트워크 오류는 다음 확인 때 */
      }
    };
    void check();
    const t = setInterval(() => void check(), intervalMs);
    const onFocus = () => void check();
    const onBlur = () => pending.current && setTimeout(() => !typing() && apply(), 50);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      stopped = true;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, [router, intervalMs]);
  return null;
}
