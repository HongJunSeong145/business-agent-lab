import { DEPARTMENTS, type DepartmentCode } from "@/lib/design/tokens";
import { cn } from "@/lib/utils";

/** 국서 표시는 항상 색 + 국서명 텍스트 (9-3, 색맹 대비) */
export function DeptChip({ code, className, role }: { code: DepartmentCode; className?: string; role?: "lead" | "support" }) {
  const t = DEPARTMENTS[code];
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium", className)}
      style={{ backgroundColor: t.chipBg, color: t.ink }}
    >
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: t.base, boxShadow: `0 0 0 1px ${t.ink}33` }} />
      {t.nameKo}
      {role ? <span className="opacity-80">· {role === "lead" ? "주관" : "협조"}</span> : null}
    </span>
  );
}
