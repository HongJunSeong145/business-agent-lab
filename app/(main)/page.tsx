import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/can";
import { loadDashboard } from "@/lib/dashboard";
import { prisma } from "@/lib/db";
import { listContacts, listProfiles } from "@/lib/services/directory";
import { signedFileUrl } from "@/lib/storage/signed-url";
import { BannerEditor, ContactDirectoryEditor, MemberDirectoryEditor } from "@/components/dashboard/editors";
import {
  Banner, DepartmentCards, NearestProject, QuarterCalendarCard, RecentMeetings, Upcoming30,
} from "@/components/dashboard/sections";

export const dynamic = "force-dynamic";

/** 메인 대시보드 (8-2) — 위→아래 순서 고정: 배너 → 회의록·캘린더·30일 → 사업 막대 → 국서 카드 → 인적사항 → 연락망 */
export default async function DashboardPage() {
  const user = await requireUser();
  const [d, profiles, contacts] = await Promise.all([loadDashboard(user.termId), listProfiles(prisma, user), listContacts(prisma, user)]);
  const termTitle = d.term.banner_title ?? `제${d.term.term_number}대 ${d.term.name ?? ""} 학생회`;

  return (
    <div className="space-y-6">
      <Banner
        title={termTitle}
        subtitle={d.term.banner_subtitle}
        councilName={d.term.council.name}
        imageUrl={d.term.banner_image_key ? signedFileUrl(d.term.banner_image_key) : null}
        editor={can(user, { type: "settings.manage" }) ? <BannerEditor title={d.term.banner_title ?? ""} subtitle={d.term.banner_subtitle} hasImage={!!d.term.banner_image_key} /> : null}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-3"><RecentMeetings meetings={d.meetings} /></div>
        <div className="lg:col-span-6"><QuarterCalendarCard quarters={d.termQuarters} current={d.currentQuarter} today={d.today} /></div>
        <div className="lg:col-span-3"><Upcoming30 items={d.upcoming} today={d.today} canEdit={can(user, { type: "task.confirmDeadline" })} /></div>
      </div>

      <NearestProject project={d.nextProject} progress={d.nextProjectProgress} today={d.today} />
      <DepartmentCards cards={d.deptCards} today={d.today} />
      <MemberDirectoryEditor rows={profiles.rows} canCreate={profiles.canCreate} />
      <ContactDirectoryEditor c={contacts} />
    </div>
  );
}
