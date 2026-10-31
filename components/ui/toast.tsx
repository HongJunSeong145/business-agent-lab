"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

/** 아주 작은 토스트 저장소 — 낙관적 업데이트 실패 롤백·실행 취소 안내용 (8-1) */
type Toast = { id: number; message: string; tone: "info" | "error"; action?: { label: string; onClick: () => void }; ms: number };
type Listener = (t: Toast[]) => void;

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(toasts));

export function toast(message: string, opts: { tone?: "info" | "error"; action?: Toast["action"]; ms?: number } = {}) {
  const t: Toast = { id: ++seq, message, tone: opts.tone ?? "info", action: opts.action, ms: opts.ms ?? 5000 };
  toasts = [...toasts, t].slice(-4);
  emit();
  setTimeout(() => dismiss(t.id), t.ms);
  return t.id;
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    listeners.add(setItems);
    return () => void listeners.delete(setItems);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${t.tone === "error" ? "bg-danger" : "bg-text"}`}
        >
          <span className="flex-1">{t.message}</span>
          {t.action ? (
            <button
              className="rounded px-2 py-1 font-semibold underline-offset-2 hover:underline"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button aria-label="닫기" onClick={() => dismiss(t.id)} className="opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}
