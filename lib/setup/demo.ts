import type { Db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import type { DepartmentCode } from "@/lib/design/tokens";
import { ensureBaseSetup } from "./bootstrap";

/**
 * 데모 데이터 (지시서 0-3 ⑦, 13): 가상 인물·가상 연락처만 사용, 전부 is_demo = true.
 * 재실행 가능: 데모 사용자는 이메일로 upsert, 데모 인적사항·연락처는 지우고 다시 만든다(데모 행만).
 * 데모 계정 비밀번호는 저장소에 두지 않는다 — SEED_DEMO_PASSWORD 가 있을 때만 로그인 가능 상태로 만든다.
 */
type DemoPerson = { email: string; name: string; role: "president" | "head" | "member"; dept: DepartmentCode | null; title: string; major: string };

const PEOPLE: DemoPerson[] = [
  { email: "president@demo.kgb.invalid", name: "김데모", role: "president", dept: null, title: "학생회장", major: "디지털경영전공" },
  { email: "planning.head@demo.kgb.invalid", name: "이기획", role: "head", dept: "planning", title: "기획국장", major: "글로벌경영전공" },
  { email: "planning.member@demo.kgb.invalid", name: "박기획", role: "member", dept: "planning", title: "기획국원", major: "디지털경영전공" },
  { email: "finance.head@demo.kgb.invalid", name: "최재정", role: "head", dept: "finance", title: "재정국장", major: "글로벌경영전공" },
  { email: "finance.member@demo.kgb.invalid", name: "정재정", role: "member", dept: "finance", title: "재정국원", major: "디지털경영전공" },
  { email: "secretariat.head@demo.kgb.invalid", name: "강사무", role: "head", dept: "secretariat", title: "사무국장", major: "글로벌경영전공" },
  { email: "secretariat.member@demo.kgb.invalid", name: "조사무", role: "member", dept: "secretariat", title: "사무국원", major: "디지털경영전공" },
  { email: "promotion.head@demo.kgb.invalid", name: "윤홍보", role: "head", dept: "promotion", title: "홍보국장", major: "글로벌경영전공" },
  { email: "promotion.member@demo.kgb.invalid", name: "장홍보", role: "member", dept: "promotion", title: "홍보국원", major: "디지털경영전공" },
  { email: "operations.head@demo.kgb.invalid", name: "임집행", role: "head", dept: "operations", title: "집행국장", major: "글로벌경영전공" },
  { email: "operations.member@demo.kgb.invalid", name: "한집행", role: "member", dept: "operations", title: "집행국원", major: "디지털경영전공" },
];

const CONTACTS = [
  { category: "학교 관계자", org: "데모대학교 행정실", contact_person: "가상 담당자", title: "주무관", phone: "044-000-0001", email: "office@example.com", website: "", note: "교비 공문 접수" },
  { category: "제휴업체", org: "데모카페", contact_person: "가상 사장", title: "대표", phone: "010-0000-0101", email: "cafe@example.com", website: "https://example.com", note: "간식 행사 제휴 후보" },
  { category: "푸드트럭", org: "데모푸드트럭", contact_person: "가상 운영자", title: "운영", phone: "010-0000-0202", email: "truck@example.com", website: "", note: "" },
];

export async function seedDemo(db: Db, demoPassword?: string) {
  const term = await ensureBaseSetup(db);
  const depts = await db.department.findMany({ where: { term_id: term.id } });
  const deptId = (code: DepartmentCode | null) => (code ? depts.find((d) => d.code === code)!.id : null);
  const password_hash = demoPassword ? await hashPassword(demoPassword) : null;

  await db.memberProfile.deleteMany({ where: { term_id: term.id, is_demo: true } });
  await db.contactRow.deleteMany({ where: { term_id: term.id, is_demo: true } });

  for (const [i, p] of PEOPLE.entries()) {
    const user = await db.user.upsert({
      where: { email: p.email },
      update: { display_name: p.name, is_demo: true, ...(password_hash ? { password_hash, status: "active" } : {}) },
      create: {
        email: p.email,
        display_name: p.name,
        is_demo: true,
        password_hash,
        status: password_hash ? "active" : "invited",
      },
    });
    await db.membership.upsert({
      where: { user_id_term_id: { user_id: user.id, term_id: term.id } },
      update: { role: p.role, department_id: deptId(p.dept), position_title: p.title, is_demo: true },
      create: { user_id: user.id, term_id: term.id, role: p.role, department_id: deptId(p.dept), position_title: p.title, is_demo: true },
    });
    const n = String(i + 1).padStart(2, "0");
    await db.memberProfile.create({
      data: {
        term_id: term.id,
        user_id: user.id,
        position_title: p.title,
        name: p.name,
        major: p.major,
        student_id: `20990000${n}`,
        phone: `010-0000-00${n}`,
        gmail: `demo${n}@example.com`,
        school_email: `demo${n}@example.edu`,
        display_order: i + 1,
        is_demo: true,
      },
    });
  }

  for (const [i, c] of CONTACTS.entries()) {
    await db.contactRow.create({
      data: { term_id: term.id, category: c.category, data: c, display_order: i + 1, is_demo: true },
    });
  }

  return { users: PEOPLE.length, contacts: CONTACTS.length, loginEnabled: Boolean(password_hash) };
}

/** 데모 회의록 2건(가상 학생회·가상 인물) — 스테이징 체험용 */
const DEMO_MINUTES = [
  {
    title: "[데모] 제12차 정기회의",
    date: "2026-11-03",
    text: `[데모] 데모단과대학 학생회 제12차 정기회의록
일시 : 2026년 11월 3일(화) 19:00
장소 : 데모관 B101호

1. 기말고사 간식 나눔 행사에 관한 건
- 12월 9일(수) 데모관 로비에서 간식 80인분 나눔
- 학생회비 40만원 사용, 외부 업체 없이 직접 구입
-> 재정국은 구입 리스트를 11월 20일까지 정리
-> 홍보국은 온라인 카드뉴스로만 홍보(무비용)
-> 집행국은 당일 배부 인원 배치표 작성

2. 기타
- 다음 회의는 11월 10일(화)`,
  },
  {
    title: "[데모] 제13차 정기회의",
    date: "2026-11-10",
    text: `[데모] 데모단과대학 학생회 제13차 정기회의록
일시 : 2026년 11월 10일(화) 19:00
장소 : 데모관 B101호

1. 연말 단과대 축제에 관한 건
- 12월 18일(금) 데모관 앞 광장, 교비 300만원
- 무대·음향은 외부 대행사에 맡김
-> 기획국은 축제 기획안 초안을 11월 13일까지 작성
-> 사무국은 대행사 견적을 3곳 이상 받기

2. 기타
- 학생회실 비품 정리는 사무국이 맡음`,
  },
];

/**
 * 데모 사업의 예시 업무 — 사용자가 알려 준 승인요청 패턴(회의록에서 나온 일을 국서별로, 마감은 행사일에서 역산).
 * 국서 역할 목록(표준 업무 템플릿)을 그대로 업무로 넣지 않는다(사용자 결정 2026-10-31).
 */
const DEMO_TASKS: Record<string, { dept: string; title: string; description: string; due: string; reason: string; criteria: string[] }[]> = {
  "[데모] 기말고사 간식 나눔": [
    { dept: "planning", title: "간식 나눔 기획안 작성(여러 버전)", description: "객단가·배급 방식(선착순 등)을 정하고, 오프라인 홍보물 비용만큼 간식을 덜 나누더라도 홍보를 늘리는 안과 비교한 여러 버전으로 작성.", due: "2026-11-19", reason: "역산: 홍보물이 행사 10일 전(11/29)쯤 나오려면 기획안은 11/19까지", criteria: ["객단가·배급 방식 결정", "온라인 전용 vs 오프라인 홍보 포함 버전 비교", "예산 40만 원 안에서 버전별 수량·비용"] },
    { dept: "promotion", title: "간식 나눔 홍보물 작업 정리·제작(기획안 기준)", description: "결재 기획안에 맞춰 필요한 홍보물 작업을 스스로 판단해 투두리스트로 옮기고 제작.", due: "2026-11-29", reason: "역산: 게시 기간을 두려면 행사 10일 전 완성", criteria: ["기획안 기준 홍보물 작업 목록", "시안 제작", "게시 일정"] },
    { dept: "operations", title: "간식 나눔 당일 집행매뉴얼 작성", description: "행사 당일 인력 배치·배부 동선·준비물·비상 대응을 정리해 타 국서가 매뉴얼대로 움직이게 한다.", due: "2026-12-02", reason: "집행 매뉴얼: 늦어도 행사 7일 전", criteria: ["역할표·인력 배치", "배부 동선·시간표", "준비물 체크리스트", "비상 대응"] },
    { dept: "finance", title: "간식 나눔 재정 준비(영수 처리·업체 정리·예산안)", description: "학생회비 사업: 영수증·이체내역 처리 준비, 간식 업체·가격 정리, 기획안의 간식 가격을 바탕으로 예산안 작성.", due: "2026-11-24", reason: "역산: 기획안(11/19) 확정 후 구입 전까지", criteria: ["영수증·이체내역 처리 준비", "간식 업체·가격 정리", "기획안 기반 예산안"] },
  ],
  "[데모] 연말 단과대 축제": [
    { dept: "planning", title: "연말 축제 기획안 작성", description: "교비 사업: 행사 21일 전 행정실 송부를 위해 일시·장소·예산·프로그램·타임테이블을 담은 기획안 작성.", due: "2026-11-20", reason: "역산: 교비 행정실 송부(행사 21일 전, 11/27) 전 결재", criteria: ["프로그램·타임테이블", "예산(세금 10% 포함)", "외부업체 이용 범위"] },
    { dept: "secretariat", title: "연말 축제 외부업체 견적·문의", description: "무대·음향 등 외부업체 후보에 견적을 요청하고 회신을 정리.", due: "2026-11-25", reason: "역산: 송부 전 업체 확정", criteria: ["업체 후보 목록", "견적 요청·회신 정리"] },
  ],
};

/** 예전 데모 데이터(표준 업무 15건씩 자동 생성)를 예시 업무로 바꾼다 — 한 번만(손대지 않은 표준 업무만 지움) */
export async function replaceDemoTemplateTasks(db: Db) {
  const term = await ensureBaseSetup(db);
  const marker = await db.setting.findUnique({ where: { term_id_key: { term_id: term.id, key: "DEMO_TASKS_V2" } } });
  if (marker) return { replaced: 0 };
  const projects = await db.project.findMany({ where: { term_id: term.id, deleted_at: null, OR: [{ is_demo: true }, { title: { startsWith: "[데모]" } }] } });
  let replaced = 0;
  const pres = await db.membership.findFirst({ where: { term_id: term.id, role: { in: ["president", "admin"] } } });
  for (const p of projects) {
    const r = await db.task.updateMany({
      where: { project_id: p.id, deleted_at: null, template_key: { not: null }, source_proposal_id: null, is_completed: false, manual_progress: null, deliverables: { none: {} } },
      data: { deleted_at: new Date() },
    });
    replaced += r.count;
    if (pres) await addDemoTasks(db, { userId: pres.user_id, role: "president", departmentId: null, departmentCode: null, termId: term.id }, p.id, p.title);
  }
  await db.setting.create({ data: { term_id: term.id, key: "DEMO_TASKS_V2", value: true } });
  return { replaced };
}

async function addDemoTasks(db: Db, actor: { userId: string; role: "president"; departmentId: null; departmentCode: null; termId: string }, projectId: string, title: string) {
  const list = DEMO_TASKS[title];
  if (!list) return;
  const { createTask } = await import("@/lib/services/tasks");
  const depts = Object.fromEntries((await db.department.findMany({ where: { term_id: actor.termId } })).map((d) => [d.code, d.id]));
  for (const t of list) {
    if (await db.task.count({ where: { project_id: projectId, title: t.title, deleted_at: null } })) continue;
    const created = await createTask(db, actor, { title: t.title, description: t.description, project_id: projectId, lead_department_id: depts[t.dept], due_date: t.due, acceptance_criteria: t.criteria.map((text) => ({ text, done: false })) });
    await db.task.update({ where: { id: created.id }, data: { due_state: "proposed", due_reason: t.reason, is_demo: true } });
  }
}

/**
 * 체험용 데모 내용: 사업 2개(학생회비 간식 나눔 / 교비 축제) + 예시 업무(국서별) + 회의록 2건(추출 완료 상태).
 * 이미 있으면 건너뛴다(사용자가 고친 내용을 지우지 않음).
 */
export async function seedDemoContent(db: Db, today: string) {
  const term = await ensureBaseSetup(db);
  if (await db.project.count({ where: { term_id: term.id, title: { startsWith: "[데모]" } } })) return { created: false };
  const presUser = await db.user.findUnique({ where: { email: PEOPLE[0]!.email } });
  if (!presUser) return { created: false };
  const actor = { userId: presUser.id, role: "president" as const, departmentId: null, departmentCode: null, termId: term.id };
  const { createProject } = await import("@/lib/services/projects");
  const projects = [
    { title: "[데모] 기말고사 간식 나눔", event_start: "2026-12-09", venue: "데모관 로비", expected_beneficiaries: 80, host: "데모단과대학 학생회", organizer: "기획국", funding: [{ source: "student_fee", amount_planned: 400000 }] },
    { title: "[데모] 연말 단과대 축제", event_start: "2026-12-18", venue: "데모관 앞 광장", expected_beneficiaries: 500, uses_external_vendor: true, host: "데모단과대학 학생회", organizer: "기획국", funding: [{ source: "school", amount_planned: 3000000 }] },
  ];
  for (const p of projects) {
    const created = await createProject(db, actor, p);
    await db.project.update({ where: { id: created.id }, data: { is_demo: true } }).catch(() => undefined);
    await addDemoTasks(db, actor, created.id, p.title);
  }
  for (const m of DEMO_MINUTES) {
    await db.meeting.create({
      data: {
        term_id: term.id, title: m.title, meeting_date: new Date(`${m.date}T00:00:00Z`), meeting_type: "regular", source: "paste", status: "extracted", uploaded_by: presUser.id, is_demo: true,
        files: { create: { original_name: "붙여넣기.txt", mime: "text/plain; charset=utf-8", extracted_text: m.text, extraction_method: "paste" } },
      },
    });
  }
  await db.setting.upsert({ where: { term_id_key: { term_id: term.id, key: "DEMO_TASKS_V2" } }, update: {}, create: { term_id: term.id, key: "DEMO_TASKS_V2", value: true } });
  void today;
  return { created: true };
}
