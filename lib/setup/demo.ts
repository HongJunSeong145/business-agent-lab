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
