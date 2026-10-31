"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/field";
import { acceptInviteAction, type AcceptState } from "./actions";

export function AcceptForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInviteAction.bind(null, token), {});
  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="email">이메일</Label>
        <Input id="email" value={email} readOnly disabled />
      </div>
      <div>
        <Label htmlFor="displayName">이름</Label>
        <Input id="displayName" name="displayName" required maxLength={50} autoComplete="name" defaultValue={state.displayName} key={state.displayName ?? ""} />
      </div>
      <div>
        <Label htmlFor="password">비밀번호 (10자 이상)</Label>
        <Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
      </div>
      <div>
        <Label htmlFor="passwordConfirm">비밀번호 확인</Label>
        <Input id="passwordConfirm" name="passwordConfirm" type="password" required minLength={10} autoComplete="new-password" />
      </div>
      <FormMessage>{state.error}</FormMessage>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "가입 중…" : "가입하고 시작하기"}
      </Button>
    </form>
  );
}
