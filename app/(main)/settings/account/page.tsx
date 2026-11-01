import { requireUser } from "@/lib/auth/session";
import { ROLE_LABEL } from "@/lib/auth/can";
import { Card, CardTitle } from "@/components/ui/card";
import { PasswordForm } from "./password-form";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">내 계정</h1>
      <Card>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">이름</dt><dd>{user.displayName}</dd>
          <dt className="text-muted">역할</dt><dd>{ROLE_LABEL[user.role]}{user.departmentName ? ` · ${user.departmentName}` : ""}</dd>
        </dl>
      </Card>
      <Card>
        <CardTitle className="mb-4">비밀번호 변경</CardTitle>
        <PasswordForm />
      </Card>
    </div>
  );
}
