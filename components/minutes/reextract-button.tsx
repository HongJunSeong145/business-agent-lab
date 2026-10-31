"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ReextractButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const r = await fetch(`/api/meetings/${meetingId}/reextract`, { method: "POST" });
          if (!r.ok) setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "다시 시도하세요.");
          setPending(false);
          router.refresh();
        }}
      >
        <RotateCcw className="h-4 w-4" /> 다시 추출
      </Button>
      {error ? <span role="alert" className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}
