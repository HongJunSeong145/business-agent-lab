/** 개발용: 파일 하나의 추출 결과를 출력 — pnpm exec tsx scripts/try-extract.ts <파일> */
import { readFileSync } from "node:fs";
import path from "node:path";
import { detectMinutesKind } from "../lib/files/detect";
import { extractMinutes } from "../lib/extract";

const file = process.argv[2];
if (!file) throw new Error("파일 경로를 지정하세요.");
const bytes = new Uint8Array(readFileSync(file));
const kind = detectMinutesKind(path.basename(file), bytes);
const r = await extractMinutes(kind, bytes);
console.log(`[${kind} / ${r.method}]\n${r.text}`);
