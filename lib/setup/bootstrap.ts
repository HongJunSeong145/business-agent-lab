import type { Db } from "@/lib/db";
import { hashPassword, validatePasswordPolicy } from "@/lib/auth/password";
import { CONTACT_CATEGORIES, DEFAULT_CONTACT_COLUMNS, DEFAULT_SETTINGS, defaultDepartments, defaultTermDates } from "./defaults";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * 기본 구조 보장 (멱등): 학생회·현재 기수·국서 5개·설정·연락망 기본 열·예결산 분기.
 * 운영·스테이징 배포 시에도 실행된다. 기존 값은 덮어쓰지 않는다.
 */
export async function ensureBaseSetup(db: Db, today = new Date()) {
  let term = await db.term.findFirst({ where: { is_current: true }, orderBy: { created_at: "asc" } });
  if (!term) {
    const council =
      (await db.council.findFirst({ orderBy: { created_at: "asc" } })) ??
      (await db.council.create({ data: { name: "우리 학생회", university: "대학교(설정 필요)", college: "단과대학(설정 필요)" } }));
    term = await db.term.create({
      data: {
        council_id: council.id,
        term_number: 1,
        name: "학생회 이름(설정 필요)",
        banner_title: "제1대 학생회",
        banner_subtitle: "설정 화면에서 학생회 정보와 배너를 입력하세요",
        is_current: true,
        ...defaultTermDates(today),
      },
    });
  }

  for (const d of defaultDepartments()) {
    await db.department.upsert({
      where: { term_id_code: { term_id: term.id, code: d.code } },
      update: {},
      create: { term_id: term.id, ...d },
    });
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.setting.upsert({
      where: { term_id_key: { term_id: term.id, key } },
      update: {},
      create: { term_id: term.id, key, value: value as Prisma.InputJsonValue },
    });
  }

  // 하루 AI 예산 기본값 변경(3,000 → 10,000원, 사용자 결정 2026-11-01): 예전 기본값 그대로인 DB 만 올린다
  await db.setting.updateMany({ where: { term_id: term.id, key: "AI_DAILY_BUDGET_KRW", value: { equals: 3000 } }, data: { value: 10000 } });

  // Phase 4 이전에 설치된 DB: 휴일 목록이 비어 있으면 기본 공휴일을 채운다(사용자가 넣은 값은 건드리지 않음)
  const holidays = await db.setting.findUnique({ where: { term_id_key: { term_id: term.id, key: "HOLIDAYS" } } });
  if (holidays && Array.isArray(holidays.value) && holidays.value.length === 0) {
    await db.setting.update({ where: { id: holidays.id }, data: { value: DEFAULT_SETTINGS.HOLIDAYS as Prisma.InputJsonValue } });
  }

  for (const [i, c] of DEFAULT_CONTACT_COLUMNS.entries()) {
    await db.contactColumn.upsert({
      where: { term_id_key: { term_id: term.id, key: c.key } },
      update: {},
      create: {
        term_id: term.id,
        key: c.key,
        label: c.label,
        type: c.type,
        display_order: i + 1,
        is_default: true,
        options: c.key === "category" ? CONTACT_CATEGORIES : undefined,
      },
    });
  }

  for (const quarter of [1, 2, 3, 4]) {
    await db.budgetPeriod.upsert({
      where: { term_id_quarter: { term_id: term.id, quarter } },
      update: {},
      create: { term_id: term.id, quarter, review_group: quarter <= 2 ? "A" : "B" },
    });
  }

  return term;
}

/**
 * 초기 관리자 보장 (지시서 13: 배포 플랫폼 환경변수로 초기 관리자 생성).
 * 이미 있으면 비밀번호를 바꾸지 않는다.
 */
export async function ensureInitialAdmin(db: Db, email: string | undefined, password: string | undefined) {
  if (!email || !password) return { created: false as const, reason: "INITIAL_ADMIN_EMAIL/PASSWORD 미설정" };
  const policy = validatePasswordPolicy(password);
  if (policy) throw new Error(`INITIAL_ADMIN_PASSWORD: ${policy}`);
  const term = await ensureBaseSetup(db);
  const normalized = email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email: normalized } });
  if (existing) {
    await db.membership.upsert({
      where: { user_id_term_id: { user_id: existing.id, term_id: term.id } },
      update: {},
      create: { user_id: existing.id, term_id: term.id, role: "admin", position_title: "관리자" },
    });
    return { created: false as const, reason: "이미 존재" };
  }
  const password_hash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: normalized, password_hash, display_name: "관리자", status: "active", password_changed_at: new Date() },
    });
    await tx.membership.create({ data: { user_id: user.id, term_id: term.id, role: "admin", position_title: "관리자" } });
    await tx.activityLog.create({
      data: { actor_kind: "system", action: "user.bootstrap_admin", entity_type: "user", entity_id: user.id },
    });
  });
  return { created: true as const };
}
