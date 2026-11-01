import { Check } from "lucide-react";
import { DEPARTMENTS, type DepartmentCode } from "@/lib/design/tokens";
import type { ProgressSource } from "@kgb/rules";
import { cn } from "@/lib/utils";

/**
 * 진척도 막대 (9-3, ADR-015).
 * - 높이 8px(목록) / 20px(대시보드), 모서리 4px, 0%도 track 표시, 숫자는 막대 오른쪽
 * - 채움 끝에 국서 ink 색 2px 경계선(저대비 국서 보완), 기획국은 채움 1px 테두리
 * - 표식: AI / 수동 / 완료 체크
 */
export function ProgressBar({
  code,
  value,
  source = "none",
  size = "sm",
  showValue = true,
  label,
}: {
  code: DepartmentCode;
  value: number;
  source?: ProgressSource;
  size?: "sm" | "lg";
  showValue?: boolean;
  label?: string;
}) {
  const t = DEPARTMENTS[code];
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        aria-label={label ?? `${t.nameKo} 진척도`}
        className={cn("relative flex-1 overflow-hidden rounded", size === "sm" ? "h-2" : "h-5")}
        style={{ backgroundColor: t.track }}
      >
        {v > 0 ? (
          <div
            className="h-full rounded-l"
            style={{
              width: `${v}%`,
              backgroundColor: t.fill,
              boxShadow: t.fillBorder ? `inset 0 0 0 1px ${t.fillBorder}` : undefined,
              borderRight: v < 100 ? `2px solid ${t.ink}` : undefined,
            }}
          />
        ) : null}
      </div>
      {showValue ? (
        <span className="tabular flex min-w-12 items-center justify-end gap-1 text-xs text-muted">
          {v}%
          {source === "completed" ? <Check aria-label="완료" className="h-3.5 w-3.5 text-success" /> : null}
          {source === "ai" ? <span className="text-[10px] font-semibold">AI</span> : null}
          {source === "manual" ? <span className="text-[10px] font-semibold">수동</span> : null}
        </span>
      ) : null}
    </div>
  );
}
