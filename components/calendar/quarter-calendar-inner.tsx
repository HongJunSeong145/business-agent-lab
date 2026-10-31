"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import koLocale from "@fullcalendar/core/locales/ko";
import type { EventClickArg, EventContentArg, EventDropArg, EventInput, EventSourceFuncArg } from "@fullcalendar/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { addDays } from "@kgb/rules";
import { DEPARTMENTS } from "@/lib/design/tokens";
import type { CalendarItem } from "@/lib/calendar";
import { api } from "@/lib/client-api";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

type Q = 1 | 2 | 3 | 4;

function toInput(i: CalendarItem): EventInput {
  const t = i.deptCode ? DEPARTMENTS[i.deptCode] : null;
  const base: EventInput = {
    id: i.id,
    title: i.title,
    start: i.start,
    end: addDays(i.end ?? i.start, 1), // 종일 일정 종료는 배타적
    allDay: true,
    editable: i.editable,
    extendedProps: i,
  };
  if (i.kind === "event_day") return { ...base, backgroundColor: i.cancelled ? "#E7E5E1" : "#1F2328", borderColor: "#1F2328", textColor: i.cancelled ? "#5F6670" : "#FFFFFF" };
  if (i.kind === "deadline" && t) return { ...base, backgroundColor: t.chipBg, borderColor: i.state === "proposed" ? t.ink : t.base, textColor: t.ink };
  return { ...base, backgroundColor: "#EEF3F8", borderColor: "#3B5B7A", textColor: "#3B5B7A" };
}

function EventContent({ event }: EventContentArg) {
  const i = event.extendedProps as CalendarItem;
  const t = i.deptCode ? DEPARTMENTS[i.deptCode] : null;
  return (
    <span
      className={cn("flex w-full min-w-0 items-center gap-1 overflow-hidden px-1 text-[11px] leading-5", i.kind === "event_day" && "font-semibold", (i.cancelled || i.completed) && "line-through opacity-70")}
      title={`${i.title}${i.projectTitle ? ` · ${i.projectTitle}` : ""}${i.kind === "deadline" ? ` · ${i.state === "proposed" ? "AI·규칙 제안" : "확정"}` : ""}${!i.feasible ? " · 일정 불가" : ""}`}
      data-kind={i.kind}
      data-state={i.state}
    >
      {t ? <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.base, boxShadow: `0 0 0 1px ${t.ink}55` }} /> : null}
      {!i.feasible ? <AlertTriangle aria-label="일정 불가" className="h-3 w-3 shrink-0 text-danger" /> : null}
      <span className="truncate">{i.title}</span>
      {i.ghost ? <span className="shrink-0 rounded border border-dashed px-0.5 text-[9px]">AI 제안</span> : i.kind === "deadline" && i.state === "proposed" ? <span className="shrink-0 rounded border border-dashed px-0.5 text-[9px]">제안</span> : null}
    </span>
  );
}

type Pending = { arg: EventDropArg; item: CalendarItem; from: string; to: string };

export default function QuarterCalendarInner({
  quarters,
  initialQuarter,
  today,
}: {
  quarters: Record<string, string>;
  initialQuarter: Q;
  today: string;
}) {
  const [q, setQ] = useState<Q>(initialQuarter);
  const [pending, setPending] = useState<Pending | null>(null);
  const calRef = useRef<FullCalendar>(null);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qs = quarters[`q${q}_start`]!;
  const qe = quarters[`q${q}_end`]!;
  const initialDate = today >= qs && today <= qe ? today : qs;

  const fetchEvents = (info: EventSourceFuncArg, ok: (e: EventInput[]) => void, fail: (e: Error) => void) => {
    api<CalendarItem[]>(`/api/calendar?start=${info.startStr.slice(0, 10)}&end=${info.endStr.slice(0, 10)}`)
      .then((items) => ok(items.map(toInput)))
      .catch((e: Error) => {
        toast(`일정을 불러오지 못했습니다: ${e.message}`, { tone: "error" });
        fail(e);
      });
  };

  const onClick = (a: EventClickArg) => {
    const i = a.event.extendedProps as CalendarItem;
    if (!i.link) return;
    if (i.link.type === "review") {
      router.push("/review");
      return;
    }
    const next = new URLSearchParams(params);
    next.delete("task");
    next.delete("project");
    next.delete("meeting");
    if (i.link.type === "project") {
      router.push(`/projects/${i.link.id}`);
      return;
    }
    next.set("task", i.link.id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const onDrop = (arg: EventDropArg) => {
    const item = arg.event.extendedProps as CalendarItem;
    setPending({ arg, item, from: arg.oldEvent.startStr.slice(0, 10), to: arg.event.startStr.slice(0, 10) });
  };

  async function confirmDrop() {
    if (!pending) return;
    const { arg, item, to } = pending;
    setPending(null);
    try {
      if (item.link?.type === "task") {
        await api(`/api/tasks/${item.link.id}`, { method: "PATCH", body: { due_date: to } });
        toast(`'${item.title}' 마감을 ${to}로 바꿨습니다(확정).`);
      } else if (item.link?.type === "project") {
        const span = item.end ? Math.round((Date.parse(item.end) - Date.parse(item.start)) / 86_400_000) : 0;
        await api(`/api/projects/${item.link.id}/dates`, { method: "PATCH", body: { event_start: to, event_end: addDays(to, span) } });
        toast(`행사일을 ${to}로 옮겼습니다. 제안 마감을 다시 계산했습니다.`);
      }
      calRef.current?.getApi().refetchEvents();
      router.refresh();
    } catch (e) {
      arg.revert();
      toast((e as Error).message, { tone: "error" });
    }
  }

  return (
    <div>
      <div role="tablist" aria-label="분기 선택" className="mb-3 grid grid-cols-4 gap-1 rounded-lg bg-bg p-1">
        {([1, 2, 3, 4] as const).map((n) => (
          <button
            key={n}
            role="tab"
            aria-selected={n === q}
            onClick={() => setQ(n)}
            className={cn("rounded-md px-2 py-1.5 text-center text-sm", n === q ? "bg-surface font-semibold shadow-sm" : "text-muted hover:text-text")}
          >
            <span className="block">{n}분기</span>
            <span className="tabular block text-[11px] text-muted">
              {quarters[`q${n}_start`]?.slice(5).replace("-", ".")}~{quarters[`q${n}_end`]?.slice(5).replace("-", ".")}
            </span>
          </button>
        ))}
      </div>
      <div className="kgb-calendar" data-testid="quarter-calendar">
        <FullCalendar
          key={q}
          ref={calRef}
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale={koLocale}
          initialDate={initialDate}
          validRange={{ start: qs, end: addDays(qe, 1) }}
          headerToolbar={{ left: "title", center: "", right: "prev,next" }}
          fixedWeekCount={false}
          height="auto"
          dayMaxEvents={3}
          events={fetchEvents}
          eventContent={(a) => <EventContent {...a} />}
          eventClassNames={(a) => {
            const i = a.event.extendedProps as CalendarItem;
            return [i.state === "proposed" ? "kgb-proposed" : "kgb-confirmed", `kgb-${i.kind}`, ...(i.ghost ? ["kgb-ghost"] : [])];
          }}
          eventClick={onClick}
          editable
          eventDurationEditable={false}
          eventDrop={onDrop}
        />
      </div>
      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.item.kind === "event_day" ? "행사일을 옮길까요?" : "마감을 바꿀까요?"}
        description={
          pending ? (
            <>
              <p>
                <strong>{pending.item.title}</strong>: {pending.from} → {pending.to}
              </p>
              <p className="mt-1">
                {pending.item.kind === "event_day"
                  ? "제안 상태 마감은 새 행사일에 맞춰 다시 계산되고, 확정 마감은 유지됩니다(충돌 시 사업 화면에 경고)."
                  : "바꾼 마감은 '확정'이 됩니다."}
              </p>
            </>
          ) : null
        }
        confirmLabel="바꾸기"
        onConfirm={() => void confirmDrop()}
        onCancel={() => {
          pending?.arg.revert();
          setPending(null);
        }}
      />
    </div>
  );
}
