import { z } from "zod";
import type { Db } from "@/lib/db";
import { DEFAULT_PARAMS, type RuleParams } from "@kgb/rules";
import type { Holiday } from "@/lib/setup/defaults";

/** 설정(settings)에서 규칙 엔진 파라미터를 읽는다. 값이 없거나 형식이 틀리면 기본값(5-7). */
const num = (min: number, max: number) => z.number().min(min).max(max);
const durSchema = z.object(Object.fromEntries(Object.keys(DEFAULT_PARAMS.DEFAULT_DURATIONS).map((k) => [k, z.number().int().min(1).max(120)])));
const holidaySchema = z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().max(50) }));

export const PARAM_SCHEMAS = {
  SCHOOL_SUBMIT_LEAD_DAYS: num(0, 120),
  VENDOR_CONFIRM_BUFFER_DAYS: num(0, 60),
  SCHOOL_TAX_RATE: num(0, 1),
  ROSTER_THRESHOLD: num(0, 100000),
  PROMO_HIGH_COST_AMOUNT: num(0, 1e10),
  PROMO_HIGH_QTY: num(0, 1e7),
  PROMO_PUBLISH_LATEST_DAYS: num(0, 60),
  OPS_MANUAL_LATEST_DAYS: num(0, 60),
  PURCHASE_LATEST_DAYS: num(0, 60),
  EVIDENCE_PHOTO_GRACE_DAYS: num(0, 60),
  DEFAULT_DURATIONS: durSchema,
  PROMO_DURATIONS: z.object({ free: z.number().int().min(1).max(120), low: z.number().int().min(1).max(120), high: z.number().int().min(1).max(120) }),
  HOLIDAYS: holidaySchema,
} as const;

export async function loadRuleParams(db: Db, termId: string): Promise<RuleParams & { holidayList: Holiday[] }> {
  const rows = await db.setting.findMany({ where: { term_id: termId, key: { in: Object.keys(PARAM_SCHEMAS) } } });
  const out: Record<string, unknown> = { ...DEFAULT_PARAMS };
  let holidayList: Holiday[] = [];
  for (const r of rows) {
    const schema = PARAM_SCHEMAS[r.key as keyof typeof PARAM_SCHEMAS];
    const parsed = schema.safeParse(r.value);
    if (!parsed.success) continue;
    if (r.key === "HOLIDAYS") {
      holidayList = parsed.data as Holiday[];
      out.HOLIDAYS = holidayList.map((h) => h.date);
    } else if (r.key === "DEFAULT_DURATIONS") {
      out.DEFAULT_DURATIONS = { ...DEFAULT_PARAMS.DEFAULT_DURATIONS, ...(parsed.data as object) };
    } else {
      out[r.key] = parsed.data;
    }
  }
  return { ...(out as RuleParams), holidayList };
}
