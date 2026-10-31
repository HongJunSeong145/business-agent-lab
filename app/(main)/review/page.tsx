import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/can";
import { loadReview } from "@/lib/review";
import { EmptyState } from "@/components/common/empty-state";
import { ReviewBoard } from "@/components/review/review-board";

export const dynamic = "force-dynamic";

/** AI 제안 검토 (8-4) */
export default async function ReviewPage() {
  const user = await requireUser();
  if (!can(user, { type: "proposal.approve" })) notFound();
  const groups = await loadReview(user.termId);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">AI 제안 검토</h1>
        <p className="text-sm text-muted">승인한 항목만 실제 사업·업무가 됩니다. 제목·국서·마감을 고친 뒤 승인하면 고친 마감은 확정됩니다. 추론 항목(회의록에 없던 표준 업무)은 기본으로 선택되지 않습니다.</p>
      </div>
      {groups.length === 0 ? <EmptyState title="검토할 제안이 없습니다" description="회의록을 올리면 AI가 사업과 업무를 제안합니다." /> : <ReviewBoard key={groups.flatMap((g) => [...g.projects.flatMap((p) => p.items.map((i) => i.id)), ...g.others.map((i) => i.id)]).join()} groups={groups} />}
    </div>
  );
}
