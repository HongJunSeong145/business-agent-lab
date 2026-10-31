"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, Select } from "@/components/ui/field";
import { createInviteAction, type InviteState } from "./actions";

export function InviteForm({ departments, allowAdmin }: { departments: { id: string; name: string }[]; allowAdmin: boolean }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(createInviteAction, {});
  const [role, setRole] = useState("member");
  const [copied, setCopied] = useState(false);
  const [dept, setDept] = useState("");
  const needsDept = role === "head" || role === "member";

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <Label htmlFor="email">이메일</Label>
          <Input id="email" name="email" type="email" required defaultValue={state.draftEmail} key={state.draftEmail ?? ""} />
        </div>
        <div>
          <Label htmlFor="role">역할</Label>
          <Select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">국원</option>
            <option value="head">국장</option>
            <option value="president">학생회장</option>
            {allowAdmin ? <option value="admin">관리자</option> : null}
          </Select>
        </div>
        <div>
          <Label htmlFor="departmentId">국서</Label>
          <Select id="departmentId" name="departmentId" disabled={!needsDept} required={needsDept} value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">{needsDept ? "선택" : "해당 없음"}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </div>
      </div>
      <FormMessage>{state.error}</FormMessage>
      <Button type="submit" disabled={pending}>{pending ? "만드는 중…" : "초대 링크 만들기"}</Button>
      {state.link ? (
        <div className="space-y-2 rounded-lg border border-success/40 bg-[#EEF7F1] p-3" role="status">
          <p className="text-sm">
            <strong>{state.email}</strong> 초대 링크가 만들어졌습니다. 72시간 동안 1회만 쓸 수 있으며, 이 화면을 벗어나면 다시 볼 수 없습니다.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={state.link} aria-label="초대 링크" data-testid="invite-link" />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(state.link!);
                setCopied(true);
              }}
            >
              {copied ? "복사됨" : "복사"}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
