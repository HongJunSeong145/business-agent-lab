import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/can";
import { loadDashboard } from "@/lib/dashboard";
import {
  Banner, ContactDirectory, DepartmentCards, MemberDirectory, NearestProject, QuarterCalendarShell, RecentMeetings, Upcoming30,
} from "@/components/dashboard/sections";

export const dynamic = "force-dynamic";

/** 메인 대시보드 (8-2) — 위→아래 순서 고정: 배너 → 회의록·캘린더·30일 → 사업 막대 → 국서 카드 → 인적사항 → 연락망 */
export default async function DashboardPage() {
  const user = await requireUser();
  const d = await loadDashboard(user.termId);
  const termTitle = d.term.banner_title ?? `제${d.term.term_number}대 ${d.term.name ?? ""} 학생회`;

  return (
    <div className="space-y-6">
      <Banner title={termTitle} subtitle={d.term.banner_subtitle} councilName={d.term.council.name} canEdit={can(user, { type: "settings.manage" })} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-3"><RecentMeetings meetings={d.meetings} /></div>
        <div className="lg:col-span-6"><QuarterCalendarShell quarters={d.termQuarters} current={d.currentQuarter} /></div>
        <div className="lg:col-span-3"><Upcoming30 items={d.upcomingTasks} today={d.today} /></div>
      </div>

      <NearestProject project={d.nextProject} />
      <DepartmentCards cards={d.deptCards} today={d.today} />
      <MemberDirectory profiles={d.profiles} />
      <ContactDirectory columns={d.contactColumns} rows={d.contactRows} />
    </div>
  );
}
