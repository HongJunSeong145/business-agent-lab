import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("mb-1 block text-sm font-medium text-text", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus:border-info focus:outline-none focus:ring-2 focus:ring-info/20",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:border-info focus:outline-none focus:ring-2 focus:ring-info/20",
        className,
      )}
      {...props}
    />
  );
}

export function FormMessage({ tone = "error", children }: { tone?: "error" | "success"; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role={tone === "error" ? "alert" : "status"} className={cn("text-sm", tone === "error" ? "text-danger" : "text-success")}>
      {children}
    </p>
  );
}
