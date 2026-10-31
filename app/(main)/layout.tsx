import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { TopBar } from "@/components/layout/top-bar";
import { DrawerHost } from "@/components/layout/drawer-host";
import { Toaster } from "@/components/ui/toast";
import { LiveRefresh } from "@/components/layout/live-refresh";

export const dynamic = "force-dynamic";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <TopBar user={user} />
      <main className="mx-auto max-w-[1440px] px-4 py-6">{children}</main>
      <Suspense fallback={null}>
        <DrawerHost />
      </Suspense>
      <Toaster />
      <LiveRefresh />
    </>
  );
}
