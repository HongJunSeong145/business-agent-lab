import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/can";
import { loadRuleParams } from "@/lib/rule-params";
import { Card, CardTitle } from "@/components/ui/card";
import { RulesForm } from "@/components/settings/rules-form";
import { SettingsHistory } from "@/components/settings/settings-history";

export const dynamic = "force-dynamic";

export default async function RulesSettingsPage() {
  const user = await requireUser();
  if (!can(user, { type: "settings.manage" })) notFound();
  const { holidayList, ...params } = await loadRuleParams(prisma, user.termId);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold">규칙 파라미터·휴일</h1>
      <Card><RulesForm initial={params} holidays={holidayList} /></Card>
      <Card>
        <CardTitle className="mb-2">변경 이력</CardTitle>
        <SettingsHistory termId={user.termId} action="settings.rules" />
      </Card>
    </div>
  );
}
