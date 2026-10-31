import { z } from "zod";
import { TEMPLATE_ORDER } from "@kgb/rules";
import { deptEnum } from "./a1";

/**
 * A2 사업·업무 추출 및 국서 배정 (6-2 A2) — 결과는 '제안'일 뿐이며 코드가 proposals 로 바꾼다.
 */
const evidence = z.array(z.object({ para: z.number().int().min(1), quote: z.string().max(300) })).max(5);
const templateKey = z.enum(TEMPLATE_ORDER as [string, ...string[]]);

export const a2Schema = z.object({
  projects: z
    .array(
      z.object({
        ref: z.string().min(1).max(20),
        /** 기존 사업과 같은 사업이면 그 id, 새 사업이면 null */
        existing_project_id: z.string().uuid().nullable(),
        title: z.string().min(1).max(150),
        category: z.enum(["event", "promotion", "partnership", "welfare", "admin", "other"]),
        event_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        venue: z.string().max(150).nullable(),
        beneficiaries: z.number().int().min(0).nullable(),
        funding: z.array(z.enum(["school", "student_fee"])).max(2),
        uses_vendor: z.boolean().nullable(),
        evidence,
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(10),
  tasks: z
    .array(
      z.object({
        /** projects[].ref, 또는 기존 사업 id, 사업 외 업무면 null */
        project_ref: z.string().max(60).nullable(),
        title: z.string().min(1).max(150),
        description: z.string().max(1000).nullable(),
        lead_department: deptEnum,
        support_departments: z.array(deptEnum).max(4),
        template_key: templateKey.nullable(),
        assignee_hint: z.string().max(100).nullable(),
        /** 마감: 회의록에 적힌 기한(minutes) 또는 회의록의 행사일·선후관계로 거꾸로 계산한 날짜(reasoned). 근거가 없으면 null(규칙 엔진) */
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        due_basis: z.enum(["minutes", "reasoned"]).nullable().default(null),
        /** 왜 이 날짜인지(예: "홍보물이 행사 10일 전(11/27)까지 나오려면 기획안은 11/17까지") */
        due_reason: z.string().max(300).nullable().default(null),
        /** 이 업무에서 할 일 세부 항목(국서 투두·완료 기준이 된다) */
        checklist: z.array(z.string().min(1).max(200)).max(8).default([]),
        inferred: z.boolean(),
        inference_reason: z.string().max(300).nullable(),
        evidence,
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(60),
});

export type A2Output = z.infer<typeof a2Schema>;
