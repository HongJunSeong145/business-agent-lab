/**
 * 형식별 테스트 픽스처 생성 — pnpm exec tsx scripts/fixtures/generate-minutes.ts
 * (EUC-KR 텍스트 파일은 Node 가 인코딩하지 못해 python3 로 만든다)
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import * as CFB from "cfb";
import { deflateSync, strToU8, zipSync } from "fflate";
import { AGENDA, HEADER, TABLE_HEADER, TABLE_ROWS, TITLE } from "../../tests/fixtures/minutes/content";

const OUT = path.resolve("tests/fixtures/minutes");
const w = (name: string, data: Uint8Array | string) => writeFileSync(path.join(OUT, name), data);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── TXT / MD ──
const plain = [TITLE, "", ...HEADER, "", "Ⅲ. 논의 및 심의 안건", ...AGENDA, "", "국서별 업무 지시 사항", TABLE_HEADER.join(" | "), ...TABLE_ROWS.map((r) => r.join(" | "))].join("\n");
w("minutes.txt", plain);
w("minutes.md", `# ${TITLE}\n\n${HEADER.map((h) => `- ${h}`).join("\n")}\n\n## 논의 및 심의 안건\n\n${AGENDA.join("\n")}\n\n## 국서별 업무 지시 사항\n\n| ${TABLE_HEADER.join(" | ")} |\n|---|---|---|\n${TABLE_ROWS.map((r) => `| ${r.join(" | ")} |`).join("\n")}\n`);
execFileSync("python3", ["-c", `import sys;open(sys.argv[1],"wb").write(open(sys.argv[2],encoding="utf-8").read().encode("cp949"))`, path.join(OUT, "minutes-euckr.txt"), path.join(OUT, "minutes.txt")]);

// ── DOCX (최소 OOXML) ──
const para = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${esc(t)}</w:t></w:r></w:p></w:tc>`;
const docBody = [TITLE, ...HEADER, ...AGENDA, "국서별 업무 지시 사항"].map(para).join("") +
  `<w:tbl>${[TABLE_HEADER, ...TABLE_ROWS].map((r) => `<w:tr>${r.map(cell).join("")}</w:tr>`).join("")}</w:tbl>`;
w("minutes.docx", zipSync({
  "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
  "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
  "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${docBody}</w:body></w:document>`),
}));

// ── HWPX (OWPML: 문단 + 문단 안의 표) ──
const hp = (t: string) => `<hp:p><hp:run><hp:t>${esc(t)}</hp:t></hp:run></hp:p>`;
const hcell = (t: string) => `<hp:tc><hp:subList>${hp(t)}</hp:subList></hp:tc>`;
const hwpxSection = `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">` +
  [TITLE, ...HEADER, ...AGENDA, "국서별 업무 지시 사항"].map(hp).join("") +
  `<hp:p><hp:run><hp:tbl>${[TABLE_HEADER, ...TABLE_ROWS].map((r) => `<hp:tr>${r.map(hcell).join("")}</hp:tr>`).join("")}</hp:tbl></hp:run></hp:p></hs:sec>`;
w("minutes.hwpx", zipSync({
  mimetype: [strToU8("application/hwp+zip"), { level: 0 }],
  "Contents/content.hpf": strToU8(`<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/"/>`),
  "Contents/section0.xml": strToU8(hwpxSection),
}));

// ── HWP 5.0 (합성: FileHeader + 압축된 BodyText/Section0 PARA_TEXT 레코드 + PrvText) ──
function record(tag: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.byteLength);
  new DataView(out.buffer).setUint32(0, (tag & 0x3ff) | (payload.byteLength << 20), true);
  out.set(payload, 4);
  return out;
}
function utf16(s: string): Uint8Array {
  const b = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) new DataView(b.buffer).setUint16(i * 2, s.charCodeAt(i), true);
  return b;
}
function paraText(s: string): Uint8Array {
  // 실제 문서처럼 확장 컨트롤(8 WCHAR, 코드 2 = 구역 정의) + 본문 + 문단 끝(13)
  const ctrl = new Uint8Array(16);
  new DataView(ctrl.buffer).setUint16(0, 2, true);
  const body = utf16(s + "\r");
  const all = new Uint8Array(ctrl.byteLength + body.byteLength);
  all.set(ctrl);
  all.set(body, ctrl.byteLength);
  return record(67, all);
}
function hwpFile(opts: { flags: number; body: Uint8Array | null; prv: string | null }): Uint8Array {
  const header = new Uint8Array(256);
  header.set(new TextEncoder().encode("HWP Document File"));
  new DataView(header.buffer).setUint32(32, 0x05000300, true); // 버전 5.0.3.0
  new DataView(header.buffer).setUint32(36, opts.flags, true);
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, "/FileHeader", Buffer.from(header));
  if (opts.body) CFB.utils.cfb_add(cfb, "/BodyText/Section0", Buffer.from(opts.body));
  if (opts.prv) CFB.utils.cfb_add(cfb, "/PrvText", Buffer.from(utf16(opts.prv)));
  return new Uint8Array(CFB.write(cfb, { type: "buffer" }) as Buffer);
}
const hwpLines = [TITLE, ...HEADER, ...AGENDA, "국서별 업무 지시 사항", ...[TABLE_HEADER, ...TABLE_ROWS].flat()];
const records = hwpLines.map(paraText);
const bodyRaw = new Uint8Array(records.reduce((n, r) => n + r.byteLength, 0));
records.reduce((off, r) => (bodyRaw.set(r, off), off + r.byteLength), 0);
w("minutes.hwp", hwpFile({ flags: 1, body: deflateSync(bodyRaw), prv: `<${TITLE}>` }));
w("minutes-prvtext-only.hwp", hwpFile({ flags: 1, body: new Uint8Array([1, 2, 3, 4, 5]), prv: `<${TITLE}><${AGENDA[1]}>` }));
w("encrypted.hwp", hwpFile({ flags: 3, body: deflateSync(bodyRaw), prv: null }));

// ── 손상 파일 ──
w("corrupt.pdf", "%PDF-1.7\n1 0 obj << /Type /Catalog >> broken");
w("corrupt.hwpx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 9, 9, 9]));
w("not-a-pdf.pdf", "This is plain text pretending to be a PDF");
w("program.exe", new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]));

// ── PDF (Chromium 인쇄로 텍스트 레이어 포함) ──
const css = `body{font-family:"Noto Sans CJK KR","Noto Sans KR",sans-serif;font-size:11pt;margin:0} table{border-collapse:collapse} td{border:1px solid #333;padding:4px 8px}`;
const pageHtml = (lines: string[]) => lines.map((l) => `<p style="margin:2px 0">${esc(l)}</p>`).join("");
const tableHtml = `<table>${[TABLE_HEADER, ...TABLE_ROWS].map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;

const browser = await chromium.launch();
const page = await browser.newPage();
// 1) 일반 세로 A4
await page.setContent(`<style>${css} body{padding:40px}</style><h1 style="font-size:16pt">${esc(TITLE)}</h1>${pageHtml(HEADER)}<h2 style="font-size:13pt">Ⅲ. 논의 및 심의 안건</h2>${pageHtml(AGENDA)}<h2 style="font-size:13pt">국서별 업무 지시 사항</h2>${tableHtml}`);
w("minutes.pdf", await page.pdf({ format: "A4" }));
// 2) 가로 A4 에 두 쪽(2-up 소책자) — 왼쪽: 표지·개요, 오른쪽: 안건·업무 지시
await page.setContent(`<style>${css} .sheet{display:flex;width:297mm;height:209mm} .half{width:148.5mm;padding:14mm;box-sizing:border-box}</style>
<div class="sheet"><div class="half"><h1 style="font-size:16pt">${esc(TITLE)}</h1>${pageHtml(HEADER)}<h2 style="font-size:13pt">Ⅲ. 논의 및 심의 안건</h2>${pageHtml(AGENDA.slice(0, 4))}<p style="text-align:center">- 1 -</p></div>
<div class="half">${pageHtml(AGENDA.slice(4))}<h2 style="font-size:13pt">국서별 업무 지시 사항</h2>${tableHtml}<p style="text-align:center">- 2 -</p></div></div>`);
w("minutes-2up.pdf", await page.pdf({ format: "A4", landscape: true, printBackground: true }));
// 3) 스캔 PDF 흉내: 글자를 그림(canvas 이미지)으로만 넣어 텍스트 레이어가 없음
await page.setContent(`<canvas id="c" width="900" height="300"></canvas><img id="i">`);
await page.evaluate(([title]) => {
  const c = document.getElementById("c") as HTMLCanvasElement;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, 900, 300); g.fillStyle = "#000"; g.font = "28px sans-serif"; g.fillText(title!, 20, 80);
  (document.getElementById("i") as HTMLImageElement).src = c.toDataURL("image/png");
  c.remove();
}, [TITLE]);
await page.waitForFunction(() => (document.getElementById("i") as HTMLImageElement).complete);
w("scanned.pdf", await page.pdf({ format: "A4" }));
await browser.close();
console.log("픽스처 생성 완료:", OUT);
