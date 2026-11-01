import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/can";
import { loadReview } from "@/lib/review";
import { prisma } from "@/lib/db";
import { EmptyState } from "@/components/common/empty-state";
import { ReviewBoard } from "@/components/review/review-board";

export const dynamic = "force-dynamic";

/** AI 제안 검토 (8-4) */
export default async function ReviewPage() {
  const user = await requireUser();
  if (!can(user, { type: "proposal.approve" })) notFound();
  const groups = await loadReview(user.termId);
  const deptIds = Object.fromEntries((await prisma.department.findMany({ where: { term_id: user.termId }, select: { id: true, code: true } })).map((d) => [d.code, d.id]));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">AI 제안 검토</h1>
        <p className="text-sm text-muted">승인한 항목만 실제 사업·업무가 됩니다. 제목·국서·마감을 고친 뒤 승인하면 고친 마감은 확정됩니다. 회의록에 나온 일만 국서별로 제안합니다. 마감 근거를 확인하고, 빠진 업무는 국서 구역의 “직접 추가”로 넣으세요.</p>
      </div>
      {groups.length === 0 ? <EmptyState title="검토할 제안이 없습니다" description="회의록을 올리면 AI가 사업과 업무를 제안합니다." /> : <ReviewBoard key={groups.flatMap((g) => [...g.projects.flatMap((p) => p.items.map((i) => i.id)), ...g.others.map((i) => i.id)]).join()} groups={groups} deptIds={deptIds} />}
    </div>
  );
}
