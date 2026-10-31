"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/field";
import { changePasswordAction, type PwState } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState<PwState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="max-w-sm space-y-4">
      <div><Label htmlFor="current">현재 비밀번호</Label><Input id="current" name="current" type="password" required autoComplete="current-password" /></div>
      <div><Label htmlFor="next">새 비밀번호 (10자 이상)</Label><Input id="next" name="next" type="password" required minLength={10} autoComplete="new-password" /></div>
      <div><Label htmlFor="confirm">새 비밀번호 확인</Label><Input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" /></div>
      <FormMessage>{state.error}</FormMessage>
      <Button type="submit" disabled={pending}>{pending ? "변경 중…" : "비밀번호 변경"}</Button>
      <p className="text-xs text-muted">변경하면 모든 기기에서 로그아웃됩니다.</p>
    </form>
  );
}
