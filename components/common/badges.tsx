import { cn } from "@/lib/utils";

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center rounded border border-dashed border-warning px-1.5 py-0.5 text-xs font-medium text-warning-text", className)}
      title="시드로 만든 데모 데이터입니다"
    >
      데모 데이터
    </span>
  );
}

export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-md bg-bg px-2 py-0.5 text-xs font-medium text-muted", className)}>{children}</span>;
}
