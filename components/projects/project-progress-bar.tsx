import Link from "next/link";
import { DEPARTMENTS, DEPARTMENT_CODES, type DepartmentCode } from "@/lib/design/tokens";
import type { ProjectProgress } from "@kgb/rules";

/**
 * 사업 진척도 막대 (8-2 ③, 9-3): 하나의 가로 막대를 국서 가중치 비율로 나누고(기획→재정→사무→홍보→집행),
 * 각 구간은 국서 색 — 완료 비율만큼 진한 색, 나머지는 같은 색의 연한 track. 구간 위 국서명, 아래 %.
 */
export function ProjectProgressBar({ progress, projectId }: { progress: ProjectProgress; projectId?: string }) {
  const segs = progress.segments.filter((s) => s.share > 0);
  return (
    <div className="flex items-end gap-3" data-testid="project-progress">
      <div className="flex-1">
        {segs.length === 0 ? (
          <div className="h-5 rounded bg-bg" aria-label="업무가 없어 진척도가 없습니다" />
        ) : (
          <div className="flex w-full gap-0.5">
            {segs.map((s) => {
              const t = DEPARTMENTS[s.code as DepartmentCode];
              const pct = Math.round(s.progress);
              const body = (
                <>
                  <span className="mb-1 block truncate text-xs font-medium" style={{ color: t.ink }}>{t.nameKo}</span>
                  <span
                    className="relative block h-5 overflow-hidden rounded"
                    style={{ backgroundColor: t.track, boxShadow: t.fillBorder ? `inset 0 0 0 1px ${t.fillBorder}` : undefined }}
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${t.nameKo} ${pct}%`}
                  >
                    {pct > 0 ? <span className="block h-full" style={{ width: `${pct}%`, backgroundColor: t.fill, borderRight: pct < 100 ? `2px solid ${t.ink}` : undefined }} /> : null}
                  </span>
                  <span className="tabular mt-1 block text-xs text-muted">{pct}%</span>
                </>
              );
              return (
                <div key={s.code} style={{ width: `${s.share * 100}%` }} className="min-w-10" title={`${t.nameKo}: 업무 ${s.taskCount}건, ${pct}%`}>
                  {projectId ? (
                    <Link href={`/departments/${s.code}?in_project=${projectId}`} className="block hover:opacity-90">{body}</Link>
                  ) : body}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <span className="tabular pb-5 text-xl font-semibold" aria-label="사업 전체 진척도">{Math.round(progress.total)}%</span>
    </div>
  );
}

export const DEPT_ORDER = DEPARTMENT_CODES;
