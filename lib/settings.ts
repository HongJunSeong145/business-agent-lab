import type { Db } from "@/lib/db";
import type { Settings } from "@/lib/auth/can";

/** 권한 판단에 필요한 기수 설정값 (Q4 등) */
export async function getPermissionSettings(db: Db, termId: string): Promise<Settings> {
  const s = await db.setting.findUnique({ where: { term_id_key: { term_id: termId, key: "MEMBER_CAN_UPLOAD_MINUTES" } } });
  return { memberCanUploadMinutes: s?.value === true };
}

export async function getNumberSetting(db: Db, termId: string, key: string, fallback: number): Promise<number> {
  const s = await db.setting.findUnique({ where: { term_id_key: { term_id: termId, key } } });
  return typeof s?.value === "number" ? s.value : fallback;
}
