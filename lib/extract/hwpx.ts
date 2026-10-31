import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { ExtractionError, REUPLOAD_HINT } from "./errors";

/**
 * HWPX(OWPML) 추출: ZIP 안의 Contents/section*.xml 을 순서대로 읽는다.
 *  - 문단(hp:p)마다 한 줄, 표(hp:tbl)는 행마다 "칸 | 칸 | 칸" 한 줄.
 */
type XNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: true,
  trimValues: false,
  processEntities: true,
  parseTagValue: false,
});

function tagOf(n: XNode): string | null {
  for (const k of Object.keys(n)) if (k !== ":@") return k;
  return null;
}
function local(tag: string): string {
  const i = tag.indexOf(":");
  return i >= 0 ? tag.slice(i + 1) : tag;
}
function children(n: XNode, tag: string): XNode[] {
  return (n[tag] as XNode[] | undefined) ?? [];
}

/** 문단 안의 글자만 (표는 제외) */
function inlineText(nodes: XNode[]): string {
  let s = "";
  for (const n of nodes) {
    const tag = tagOf(n);
    if (!tag) continue;
    if (tag === "#text") {
      s += String(n["#text"]);
      continue;
    }
    const name = local(tag);
    if (name === "tbl") continue;
    if (name === "tab") s += "\t";
    else if (name === "lineBreak") s += "\n";
    else s += inlineText(children(n, tag));
  }
  return s;
}

function cellText(tc: XNode, tag: string): string {
  const lines: string[] = [];
  walk(children(tc, tag), lines);
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

function tableLines(tbl: XNode, tag: string, out: string[]) {
  for (const tr of children(tbl, tag)) {
    const trTag = tagOf(tr);
    if (!trTag || local(trTag) !== "tr") continue;
    const cells = children(tr, trTag)
      .filter((c) => local(tagOf(c) ?? "") === "tc")
      .map((c) => cellText(c, tagOf(c)!));
    if (cells.some((c) => c)) out.push(cells.join(" | "));
  }
}

function walk(nodes: XNode[], out: string[]) {
  for (const n of nodes) {
    const tag = tagOf(n);
    if (!tag || tag === "#text") continue;
    const name = local(tag);
    if (name === "p") {
      const kids = children(n, tag);
      const text = inlineText(kids);
      if (text.trim()) out.push(text);
      // 문단 안에 들어 있는 표는 문단 뒤에 이어서
      collectTables(kids, out);
    } else if (name === "tbl") {
      tableLines(n, tag, out);
    } else {
      walk(children(n, tag), out);
    }
  }
}

function collectTables(nodes: XNode[], out: string[]) {
  for (const n of nodes) {
    const tag = tagOf(n);
    if (!tag || tag === "#text") continue;
    if (local(tag) === "tbl") tableLines(n, tag, out);
    else if (local(tag) !== "p") collectTables(children(n, tag), out);
  }
}

export function extractHwpx(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => /^Contents\/section\d+\.xml$/i.test(f.name) });
  } catch {
    throw new ExtractionError(`HWPX 파일을 열 수 없습니다(손상되었을 수 있음). ${REUPLOAD_HINT}`, "hwpx_corrupt");
  }
  const sections = Object.keys(files).sort((a, b) => Number(/(\d+)\.xml$/i.exec(a)![1]) - Number(/(\d+)\.xml$/i.exec(b)![1]));
  if (sections.length === 0) throw new ExtractionError(`HWPX 본문을 찾을 수 없습니다. ${REUPLOAD_HINT}`, "hwpx_no_section");
  const out: string[] = [];
  try {
    for (const s of sections) walk(parser.parse(strFromU8(files[s]!)) as XNode[], out);
  } catch {
    throw new ExtractionError(`HWPX 본문 XML을 해석할 수 없습니다. ${REUPLOAD_HINT}`, "hwpx_xml");
  }
  return out.join("\n");
}
