"use client";

import dynamic from "next/dynamic";

/** FullCalendar 는 브라우저 전용 — 서버 렌더링 없이 불러온다 */
export const QuarterCalendar = dynamic(() => import("./quarter-calendar-inner"), {
  ssr: false,
  loading: () => <div className="h-96 animate-pulse rounded-lg bg-bg" aria-busy="true" aria-label="캘린더 불러오는 중" />,
});
