import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">로그인</h1>
      <LoginForm />
      <p className="mt-4 text-xs text-muted">가입은 초대 링크로만 가능합니다. 관리자에게 초대를 요청하세요.</p>
    </>
  );
}
