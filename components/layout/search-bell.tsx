"use client";

import { Popover } from "radix-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, Search } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type Hit = { kind: string; id: string; title: string; sub: string; href: string };
const KIND: Record<string, string> = { project: "사업", task: "업무", meeting: "회의록", reference: "레퍼런스", contact: "연락망", profile: "인적사항" };

/** 상단 전역 검색 (8-1): 입력하면 0.25초 뒤 검색, ↑↓ Enter 로 이동 */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    const n = ++seq.current;
    const t = setTimeout(() => {
      if (!term) return setHits(null);
      void api<{ hits: Hit[] }>(`/api/search?q=${encodeURIComponent(term)}`)
        .then((r) => n === seq.current && (setHits(r.hits), setActive(0)))
        .catch(() => n === seq.current && setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    router.push(h.href, { scroll: !h.href.includes("task=") });
  };
  return (
    <Popover.Root open={open && q.trim().length > 0} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative ml-2 hidden max-w-sm flex-1 lg:block">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => (setQ(e.target.value), setOpen(true))}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (!hits?.length) return;
              if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(hits.length - 1, a + 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
              if (e.key === "Enter") (e.preventDefault(), go(hits[active]!));
            }}
            role="combobox"
            aria-expanded={open && !!hits}
            aria-controls="global-search-results"
            placeholder="사업·업무·회의록·연락망 검색"
            className="h-9 w-full rounded-lg border border-border bg-bg pr-3 pl-9 text-sm placeholder:text-muted focus:border-info focus:outline-none"
            aria-label="전역 검색"
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} onOpenAutoFocus={(e) => e.preventDefault()} className="z-50 max-h-[70vh] w-[28rem] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
          {hits === null ? <p className="p-3 text-sm text-muted">검색 중…</p> : null}
          {hits?.length === 0 ? <p className="p-3 text-sm text-muted">결과가 없습니다.</p> : null}
          <ul id="global-search-results" role="listbox" aria-label="검색 결과">
            {hits?.map((h, i) => (
              <li key={`${h.kind}-${h.id}`} role="option" aria-selected={i === active}>
                <button onMouseEnter={() => setActive(i)} onClick={() => go(h)} className={cn("flex w-full items-start gap-2 rounded px-2 py-1.5 text-left", i === active && "bg-bg")}>
                  <span className="mt-0.5 shrink-0 rounded border border-border px-1 text-[10px] text-muted">{KIND[h.kind]}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{h.title}</span>
                    {h.sub ? <span className="block truncate text-xs text-muted">{h.sub}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type Note = { id: string; title: string; body: string | null; link: string | null; severity: string; read: boolean; at: string };

/** 알림 벨 (8-1): 열면 최근 30건, 누르면 해당 화면으로 + 읽음 */
export function NotificationBell({ unread: initial }: { unread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ unread: number; items: Note[] } | null>(null);
  const unread = data?.unread ?? initial;
  const load = () => void api<{ unread: number; items: Note[] }>("/api/notifications").then(setData).catch(() => undefined);
  const read = async (ids?: string[]) => {
    await api("/api/notifications/read", { body: { ids } }).catch(() => undefined);
    load();
    router.refresh();
  };
  return (
    <Popover.Root open={open} onOpenChange={(o) => (setOpen(o), o && load())}>
      <Popover.Trigger asChild>
        <button className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-bg" aria-label={`알림 (읽지 않은 알림 ${unread}건)`}>
          <Bell className="h-5 w-5" />
          {unread > 0 ? <span className="tabular absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold text-white">{unread}</span> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-[22rem] rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">알림</p>
            {unread > 0 ? <button className="text-xs underline" onClick={() => void read()}>모두 읽음</button> : null}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto" aria-label="알림 목록">
            {!data ? <li className="p-3 text-sm text-muted">불러오는 중…</li> : null}
            {data?.items.length === 0 ? <li className="p-3 text-sm text-muted">알림이 없습니다.</li> : null}
            {data?.items.map((n) => {
              const body = (
                <>
                  <span className={cn("block text-sm", !n.read && "font-semibold")}>{!n.read ? <span className="mr-1 inline-block h-2 w-2 rounded-full bg-info" aria-label="읽지 않음" /> : null}{n.title}</span>
                  {n.body ? <span className="block truncate text-xs text-muted">{n.body}</span> : null}
                  <span className="text-[10px] text-muted">{new Date(n.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </>
              );
              return (
                <li key={n.id} className={cn("border-b border-border last:border-0", n.severity === "warn" && "border-l-2 border-l-warning")}>
                  {n.link ? (
                    <Link href={n.link} scroll={false} className="block px-3 py-2 hover:bg-bg" onClick={() => (setOpen(false), !n.read && void read([n.id]))}>{body}</Link>
                  ) : (
                    <button className="block w-full px-3 py-2 text-left hover:bg-bg" onClick={() => !n.read && void read([n.id])}>{body}</button>
                  )}
                </li>
              );
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
