import { z } from "zod";
import { TEMPLATE_ORDER } from "@kgb/rules";
import { deptEnum } from "./a1";

/**
 * 결재 기획안 기준 재배정 (사용자 결정 2026-10-31): 결재된 최종 기획안을 기준으로 기존 업무를 고치거나 더하거나 빼는 '제안'.
 * 기존 업무는 번호(T1, T2 …)로만 가리킨다 — 코드가 실제 업무로 바꾼다.
 */
const ref = z.string().regex(/^T\d{1,3}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
export const a2pSchema = z.object({
  add_tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(150),
        description: z.string().max(1000).nullable(),
        lead_department: deptEnum,
        support_departments: z.array(deptEnum).max(4),
        template_key: z.enum(TEMPLATE_ORDER as [string, ...string[]]).nullable(),
        due_date: date,
        reason: z.string().max(300),
      }),
    )
    .max(15),
  update_tasks: z
    .array(
      z.object({
        task_ref: ref,
        title: z.string().min(1).max(150).nullable(),
        description: z.string().max(1000).nullable(),
        lead_department: deptEnum.nullable(),
        support_departments: z.array(deptEnum).max(4).nullable(),
        due_date: date,
        reason: z.string().max(300),
      }),
    )
    .max(40),
  cancel_tasks: z.array(z.object({ task_ref: ref, reason: z.string().max(300) })).max(20),
  notes: z.string().max(600),
});
export type A2pOutput = z.infer<typeof a2pSchema>;
