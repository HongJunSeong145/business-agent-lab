import { z } from "zod";

/**
 * A5 레퍼런스 정리·예시안 (6-2 A5). 레퍼런스는 URL 대신 검색 결과 번호(S1, S2 …)로만 가리킨다 —
 * 코드가 실제 검색 결과의 URL 로 바꾸므로 모델이 링크를 지어낼 수 없다.
 */
export const a5Schema = z.object({
  references: z
    .array(
      z.object({
        source_id: z.string().regex(/^S\d{1,2}$/),
        summary: z.string().min(1).max(600),
        benchmark_points: z.array(z.string().max(200)).max(5),
        relevance: z.string().max(300),
      }),
    )
    .max(8),
  examples: z
    .array(
      z.object({
        title: z.string().min(1).max(150),
        kind: z.string().max(60),
        format: z.enum(["markdown", "html", "svg"]),
        content: z.string().min(1).max(30000),
        external_send: z.boolean(),
      }),
    )
    .min(1)
    .max(4),
  /** 기획국 업무일 때만: 기획안 양식에 바로 옮길 수 있는 레퍼런스 기획안(다른 국서는 null) */
  plan_draft: z
    .object({
      title: z.string().max(150),
      event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      datetime: z.string().max(200),
      venue: z.string().max(200),
      budget: z.number().int().min(0).nullable(),
      host: z.string().max(150),
      organizer: z.string().max(150),
      purpose: z.string().max(3000),
      content: z.string().max(8000),
      timetable: z.array(z.object({ time: z.string().max(50), item: z.string().max(300) })).max(40),
    })
    .nullable(),
  notes: z.string().max(600),
});
export type A5Output = z.infer<typeof a5Schema>;
