"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export type LoginState = { error?: string; email?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  try {
    await signIn("credentials", {
      email,
      password: String(formData.get("password") ?? ""),
      redirectTo: "/",
    });
    return {};
  } catch (e) {
    if (e instanceof AuthError) {
      const code = (e as AuthError & { code?: string }).code;
      if (code === "rate_limited") return { error: "로그인 시도가 너무 많습니다. 15분 후 다시 시도하세요.", email };
      return { error: "이메일 또는 비밀번호가 올바르지 않습니다.", email };
    }
    throw e; // 성공 시 redirect(NEXT_REDIRECT) 는 그대로 전달
  }
}
