"use client";

import { Dialog } from "radix-ui";
import { FileUp, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const ACCEPT = ".hwpx,.docx,.pdf,.txt,.md,.hwp";

function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

/** 회의록 업로드 대화상자 (PART 7 단계 1): 파일 업로드 또는 텍스트 붙여넣기 */
export function UploadMinutesDialog({ trigger, maxMb }: { trigger: React.ReactNode; maxMb: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setError(null);
    setPending(false);
    setMode("file");
  };

  const pickFile = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) {
      setError(`파일이 너무 큽니다(최대 ${maxMb}MB).`);
      return;
    }
    setFile(f);
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    if (mode === "file") {
      if (!file) return setError("회의록 파일을 선택하세요.");
      fd.set("file", file);
      fd.delete("text");
    } else {
      fd.delete("file");
    }
    setPending(true);
    try {
      const res = await fetch("/api/meetings", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) {
        setError(body.error ?? "업로드하지 못했습니다. 다시 시도하세요.");
        setPending(false);
        return;
      }
      setOpen(false);
      reset();
      router.push(`/minutes?id=${body.id}`);
      router.refresh();
    } catch {
      setError("네트워크 오류로 업로드하지 못했습니다. 다시 시도하세요.");
      setPending(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (setOpen(o), o || reset())}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl focus:outline-none">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">회의록 올리기</Dialog.Title>
            <Dialog.Close className="rounded-md p-1 hover:bg-bg" aria-label="닫기"><X className="h-5 w-5" /></Dialog.Close>
          </div>
          <Dialog.Description className="mb-4 text-sm text-muted">
            올리면 글자를 자동으로 추출해 회의록 공간에 저장합니다. 지원 형식: HWPX, DOCX, PDF, TXT, MD (HWP는 최선 노력).
          </Dialog.Description>

          <div role="tablist" aria-label="올리는 방법" className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-bg p-1">
            {(["file", "paste"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => (setMode(m), setError(null))}
                className={cn("rounded-md py-1.5 text-sm", mode === m ? "bg-surface font-semibold shadow-sm" : "text-muted")}
              >
                {m === "file" ? "파일 업로드" : "텍스트 붙여넣기"}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "file" ? (
              <div
                onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  pickFile(e.dataTransfer.files[0]);
                }}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center",
                  dragOver ? "border-info bg-[#EEF3F8]" : "border-border",
                )}
              >
                <FileUp className="h-6 w-6 text-muted" aria-hidden />
                {file ? (
                  <p className="text-sm font-medium" data-testid="picked-file">{file.name} <span className="text-muted">({(file.size / 1024).toFixed(0)}KB)</span></p>
                ) : (
                  <p className="text-sm text-muted">파일을 여기로 끌어 놓거나</p>
                )}
                <Button type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
                  {file ? "다른 파일 선택" : "파일 선택"}
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  aria-label="회의록 파일"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="text">회의록 내용</Label>
                <textarea
                  id="text"
                  name="text"
                  rows={10}
                  required
                  className="w-full rounded-lg border border-border bg-surface p-3 text-sm focus:border-info focus:outline-none focus:ring-2 focus:ring-info/20"
                  placeholder="회의록 내용을 붙여넣으세요."
                />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="meetingDate">회의일</Label>
                <Input id="meetingDate" name="meetingDate" type="date" required defaultValue={todayKst()} />
              </div>
              <div>
                <Label htmlFor="meetingType">회의 유형</Label>
                <Select id="meetingType" name="meetingType" defaultValue="regular">
                  <option value="regular">정기회의</option>
                  <option value="extraordinary">임시회의</option>
                  <option value="department">국서 회의</option>
                  <option value="other">기타</option>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="title">제목 (비우면 파일명·첫 줄 사용)</Label>
              <Input id="title" name="title" maxLength={150} />
            </div>

            <FormMessage>{error}</FormMessage>
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild><Button type="button" variant="secondary">취소</Button></Dialog.Close>
              <Button type="submit" disabled={pending}>
                <Upload className="h-4 w-4" /> {pending ? "올리는 중…" : "올리기"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
