"use client";

import Link from "next/link";
import { startTransition } from "react";
import { DropdownMenu } from "radix-ui";
import { ChevronDown, LogOut, Settings, UserRound, Users } from "lucide-react";
import { logoutAction } from "@/app/(main)/actions";

export function UserMenu({
  name,
  subtitle,
  canManageMembers,
}: {
  name: string;
  subtitle: string;
  canManageMembers: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-bg" aria-label="사용자 메뉴">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E7E5E1] text-sm font-semibold">{name.slice(0, 1)}</span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-sm font-medium">{name}</span>
            <span className="block text-xs text-muted">{subtitle}</span>
          </span>
          <ChevronDown className="h-4 w-4 text-muted" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-lg border border-border bg-surface p-1 shadow-md">
          <DropdownMenu.Item asChild>
            <Link href="/settings/account" className="flex items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-bg">
              <UserRound className="h-4 w-4" /> 내 계정
            </Link>
          </DropdownMenu.Item>
          {canManageMembers ? (
            <DropdownMenu.Item asChild>
              <Link href="/settings/members" className="flex items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-bg">
                <Users className="h-4 w-4" /> 회원·초대 관리
              </Link>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Item asChild>
            <Link href="/settings" className="flex items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-bg">
              <Settings className="h-4 w-4" /> 설정
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={() => startTransition(() => logoutAction())}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-bg"
          >
            <LogOut className="h-4 w-4" /> 로그아웃
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
