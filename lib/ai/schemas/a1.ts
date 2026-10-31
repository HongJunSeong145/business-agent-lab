import { z } from "zod";

/**
 * A1 회의록 분석 결과 (meeting_analyses.summary, 6-2 A1).
 * 모든 항목은 원문 문단 번호(para, 1부터)와 짧은 인용(quote)을 갖는다 — 코드가 실제 원문과 대조해 검증한다.
 */
const ref = { para: z.number().int().min(1), quote: z.string().max(300) };
const dateConfidence = z.enum(["high", "medium", "low"]);
const dept = z.enum(["planning", "finance", "secretariat", "promotion", "operations"]);

export const a1Item = z.object({ text: z.string().min(1).max(500), ...ref });

export const a1Schema = z.object({
  agenda: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        para: z.number().int().min(1),
        kind: z.enum(["report", "deliberation", "other"]),
        decisions: z.array(a1Item).max(30),
        discussions: z.array(a1Item).max(50),
        pending: z.array(a1Item).max(20),
      }),
    )
    .max(40),
  action_items: z
    .array(
      z.object({
        who: z.string().max(100).nullable(),
        department: dept.nullable(),
        what: z.string().min(1).max(300),
        due_text: z.string().max(100).nullable(),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        date_confidence: dateConfidence,
        ...ref,
      }),
    )
    .max(60),
  mentioned_dates: z.array(z.object({ text: z.string().max(100), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), date_confidence: dateConfidence, ...ref })).max(60),
  budget: z.array(z.object({ item: z.string().max(200), amount: z.number().int().min(0).nullable(), funding_source: z.enum(["school", "student_fee"]).nullable(), ...ref })).max(40),
  events: z
    .array(
      z.object({
        title: z.string().min(1).max(150),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        date_confidence: dateConfidence,
        venue: z.string().max(150).nullable(),
        beneficiaries: z.number().int().min(0).nullable(),
        funding: z.array(z.enum(["school", "student_fee"])).max(2),
        uses_vendor: z.boolean().nullable(),
        ...ref,
      }),
    )
    .max(20),
});

export type A1Summary = z.infer<typeof a1Schema>;
export type DeptCode = z.infer<typeof dept>;
export { dept as deptEnum };
