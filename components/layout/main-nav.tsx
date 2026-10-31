"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { DEPARTMENTS, DEPARTMENT_CODES } from "@/lib/design/tokens";
import { cn } from "@/lib/utils";

/** 상단 주 메뉴: 회의록 · 사업 · 국서(5개) */
export function MainNav() {
  const path = usePathname();
  const item = (href: string, label: string) => (
    <Link href={href} className={cn("rounded-lg px-2.5 py-1.5 text-sm hover:bg-bg", path.startsWith(href) && "font-semibold")}>{label}</Link>
  );
  return (
    <nav aria-label="주 메뉴" className="hidden items-center gap-0.5 md:flex">
      {item("/minutes", "회의록")}
      {item("/projects", "사업")}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className={cn("inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm hover:bg-bg", path.startsWith("/departments") && "font-semibold")}>
          국서 <ChevronDown className="h-3.5 w-3.5" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content sideOffset={6} className="z-50 min-w-40 rounded-lg border border-border bg-surface p-1 shadow-md">
            {DEPARTMENT_CODES.map((c) => (
              <DropdownMenu.Item key={c} asChild>
                <Link href={`/departments/${c}`} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-bg">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: DEPARTMENTS[c].base, boxShadow: `0 0 0 1px ${DEPARTMENTS[c].ink}33` }} />
                  {DEPARTMENTS[c].nameKo}
                </Link>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </nav>
  );
}
