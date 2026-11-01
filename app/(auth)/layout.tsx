export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-[calc(100vh-2rem)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-2xl font-bold tracking-tight">KGB_Agent</p>
          <p className="mt-1 text-sm text-muted">학생회 업무 지원 플랫폼</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-6">{children}</div>
      </div>
    </main>
  );
}
