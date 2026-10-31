"use client";

import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * 오른쪽 사이드 드로어 셸 (8-1, D12): URL 쿼리 ?task= / ?meeting= / ?project= 로 열리고 공유 가능.
 * 상세 탭 내용은 각 Phase 에서 채운다. 지금은 DB 의 기본 정보만 보여준다.
 */
const TYPES = ["task", "meeting", "project"] as const;
type DrawerType = (typeof TYPES)[number];
const TYPE_LABEL: Record<DrawerType, string> = { task: "업무", meeting: "회의록", project: "사업" };

type DrawerData = { title: string; fields: { label: string; value: string }[] };

export function DrawerHost() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const type = TYPES.find((t) => params.get(t));
  const id = type ? params.get(type) : null;
  const [state, setState] = useState<{ key: string; data?: DrawerData; error?: string } | null>(null);
  const key = type && id ? `${type}:${id}` : null;

  useEffect(() => {
    if (!type || !id || !key) return;
    let cancelled = false;
    fetch(`/api/drawer?type=${type}&id=${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (cancelled) return;
        if (r.ok) setState({ key, data: (await r.json()) as DrawerData });
        else setState({ key, error: r.status === 404 ? "항목을 찾을 수 없습니다." : "불러오지 못했습니다. 다시 시도하세요." });
      })
      .catch(() => !cancelled && setState({ key, error: "불러오지 못했습니다. 다시 시도하세요." }));
    return () => {
      cancelled = true;
    };
  }, [type, id, key]);

  const close = () => {
    const next = new URLSearchParams(params);
    TYPES.forEach((t) => next.delete(t));
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const current = state && state.key === key ? state : null;

  return (
    <Dialog.Root open={Boolean(key)} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20" />
        <Dialog.Content className="fixed top-0 right-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-border bg-surface shadow-xl focus:outline-none">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <Dialog.Title className="text-base font-semibold">
              {type ? TYPE_LABEL[type] : ""} {current?.data ? `· ${current.data.title}` : ""}
            </Dialog.Title>
            <Dialog.Close className="rounded-md p-1 hover:bg-bg" aria-label="닫기">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">상세 정보 드로어</Dialog.Description>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {!current ? (
              <div className="space-y-3" aria-busy="true">
                <div className="h-5 w-2/3 animate-pulse rounded bg-bg" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-bg" />
                <div className="h-4 w-3/5 animate-pulse rounded bg-bg" />
              </div>
            ) : current.error ? (
              <p role="alert" className="text-sm text-danger">{current.error}</p>
            ) : (
              <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
                {current.data!.fields.map((f) => (
                  <div key={f.label} className="contents">
                    <dt className="text-muted">{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
