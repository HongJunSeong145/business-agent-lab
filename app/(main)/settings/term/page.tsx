import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/can";
import { dateColumnToString } from "@/lib/utils";
import { Card, CardTitle } from "@/components/ui/card";
import { TermForm } from "@/components/settings/term-form";
import { SettingsHistory } from "@/components/settings/settings-history";

export const dynamic = "force-dynamic";

export default async function TermSettingsPage() {
  const user = await requireUser();
  if (!can(user, { type: "settings.manage" })) notFound();
  const t = await prisma.term.findUniqueOrThrow({ where: { id: user.termId }, include: { council: true } });
  const s = dateColumnToString;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold">기수·분기 설정</h1>
      <Card>
        <TermForm
          initial={{
            council_name: t.council.name, university: t.council.university, college: t.council.college, term_number: t.term_number, name: t.name ?? "",
            banner_title: t.banner_title ?? "", banner_subtitle: t.banner_subtitle ?? "",
            q1_start: s(t.q1_start), q1_end: s(t.q1_end), q2_start: s(t.q2_start), q2_end: s(t.q2_end),
            q3_start: s(t.q3_start), q3_end: s(t.q3_end), q4_start: s(t.q4_start), q4_end: s(t.q4_end),
          }}
        />
      </Card>
      <Card>
        <CardTitle className="mb-2">변경 이력</CardTitle>
        <SettingsHistory termId={user.termId} action="settings.term" />
      </Card>
    </div>
  );
}
