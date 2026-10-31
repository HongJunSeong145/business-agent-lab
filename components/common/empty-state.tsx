import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center", className)}>
      <p className="text-sm font-medium text-text">{title}</p>
      {description ? <p className="text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** 아직 구현되지 않은 기능 표시 — '클릭해도 반응 없는 버튼' 대신 명시적으로 비활성 + 안내 */
export function ComingSoon({ phase, label }: { phase: number; label: string }) {
  return (
    <span
      className="inline-flex h-8 cursor-not-allowed items-center rounded-lg border border-dashed border-border px-3 text-xs text-muted"
      title={`Phase ${phase}에서 제공됩니다`}
      aria-disabled="true"
    >
      {label} · Phase {phase} 예정
    </span>
  );
}
