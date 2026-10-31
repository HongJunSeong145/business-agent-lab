-- 되돌리기 스크립트: 20261031084510_init (개발·스테이징 전용. 운영 DB에서 자동 실행 금지)
-- 적용 후 _prisma_migrations 에서 해당 행을 삭제해야 다시 deploy 가능
DROP VIEW IF EXISTS "task_progress";
-- DropForeignKey
ALTER TABLE "public"."ai_runs" DROP CONSTRAINT "ai_runs_job_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."budget_lines" DROP CONSTRAINT "budget_lines_budget_period_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."budget_lines" DROP CONSTRAINT "budget_lines_project_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."budget_periods" DROP CONSTRAINT "budget_periods_term_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."comments" DROP CONSTRAINT "comments_author_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."comments" DROP CONSTRAINT "comments_task_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."contact_columns" DROP CONSTRAINT "contact_columns_term_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."contact_rows" DROP CONSTRAINT "contact_rows_term_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."deliverable_versions" DROP CONSTRAINT "deliverable_versions_deliverable_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."deliverables" DROP CONSTRAINT "deliverables_task_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."departments" DROP CONSTRAINT "departments_term_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."evidence_items" DROP CONSTRAINT "evidence_items_project_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."evidence_items" DROP CONSTRAINT "evidence_items_purchase_item_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."evidence_items" DROP CONSTRAINT "evidence_items_requirement_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."evidence_requirements" DROP CONSTRAINT "evidence_requirements_project_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."invitations" DROP CONSTRAINT "invitations_department_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."invitations" DROP CONSTRAINT "invitations_invited_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."invitations" DROP CONSTRAINT "invitations_term_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."meeting_analyses" DROP CONSTRAINT "meeting_analyses_created_by_job_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."meeting_analyses" DROP CONSTRAINT "meeting_analyses_meeting_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."meeting_files" DROP CONSTRAINT "meeting_files_meeting_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."meetings" DROP CONSTRAINT "meetings_term_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."meetings" DROP CONSTRAINT "meetings_uploaded_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."member_profiles" DROP CONSTRAINT "member_profiles_term_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."member_profiles" DROP CONSTRAINT "member_profiles_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."memberships" DROP CONSTRAINT "memberships_department_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."memberships" DROP CONSTRAINT "memberships_term_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."memberships" DROP CONSTRAINT "memberships_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."notifications" DROP CONSTRAINT "notifications_department_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."notifications" DROP CONSTRAINT "notifications_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."partner_leads" DROP CONSTRAINT "partner_leads_contact_row_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."partner_leads" DROP CONSTRAINT "partner_leads_project_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."plan_versions" DROP CONSTRAINT "plan_versions_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."plans" DROP CONSTRAINT "plans_project_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."progress_evaluations" DROP CONSTRAINT "progress_evaluations_deliverable_version_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."progress_evaluations" DROP CONSTRAINT "progress_evaluations_task_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."progress_history" DROP CONSTRAINT "progress_history_task_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."project_funding_sources" DROP CONSTRAINT "project_funding_sources_project_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."projects" DROP CONSTRAINT "projects_created_from_meeting_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."projects" DROP CONSTRAINT "projects_term_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."proposals" DROP CONSTRAINT "proposals_term_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."purchase_items" DROP CONSTRAINT "purchase_items_project_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."reference_items" DROP CONSTRAINT "reference_items_department_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."reference_items" DROP CONSTRAINT "reference_items_project_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."reference_items" DROP CONSTRAINT "reference_items_request_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."reference_items" DROP CONSTRAINT "reference_items_task_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."reference_requests" DROP CONSTRAINT "reference_requests_task_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."schedule_events" DROP CONSTRAINT "schedule_events_color_department_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."schedule_events" DROP CONSTRAINT "schedule_events_project_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."schedule_events" DROP CONSTRAINT "schedule_events_task_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."schedule_events" DROP CONSTRAINT "schedule_events_term_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."settings" DROP CONSTRAINT "settings_term_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."task_assignees" DROP CONSTRAINT "task_assignees_task_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."task_assignees" DROP CONSTRAINT "task_assignees_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."task_departments" DROP CONSTRAINT "task_departments_department_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."task_departments" DROP CONSTRAINT "task_departments_task_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."task_dependencies" DROP CONSTRAINT "task_dependencies_depends_on_task_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."task_dependencies" DROP CONSTRAINT "task_dependencies_task_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."tasks" DROP CONSTRAINT "tasks_project_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."tasks" DROP CONSTRAINT "tasks_source_proposal_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."terms" DROP CONSTRAINT "terms_council_id_fkey";

-- DropTable
DROP TABLE "public"."activity_logs";

-- DropTable
DROP TABLE "public"."ai_jobs";

-- DropTable
DROP TABLE "public"."ai_runs";

-- DropTable
DROP TABLE "public"."budget_lines";

-- DropTable
DROP TABLE "public"."budget_periods";

-- DropTable
DROP TABLE "public"."comments";

-- DropTable
DROP TABLE "public"."contact_columns";

-- DropTable
DROP TABLE "public"."contact_rows";

-- DropTable
DROP TABLE "public"."councils";

-- DropTable
DROP TABLE "public"."deliverable_versions";

-- DropTable
DROP TABLE "public"."deliverables";

-- DropTable
DROP TABLE "public"."departments";

-- DropTable
DROP TABLE "public"."evidence_items";

-- DropTable
DROP TABLE "public"."evidence_requirements";

-- DropTable
DROP TABLE "public"."invitations";

-- DropTable
DROP TABLE "public"."login_attempts";

-- DropTable
DROP TABLE "public"."meeting_analyses";

-- DropTable
DROP TABLE "public"."meeting_files";

-- DropTable
DROP TABLE "public"."meetings";

-- DropTable
DROP TABLE "public"."member_profiles";

-- DropTable
DROP TABLE "public"."memberships";

-- DropTable
DROP TABLE "public"."notifications";

-- DropTable
DROP TABLE "public"."partner_leads";

-- DropTable
DROP TABLE "public"."plan_versions";

-- DropTable
DROP TABLE "public"."plans";

-- DropTable
DROP TABLE "public"."progress_evaluations";

-- DropTable
DROP TABLE "public"."progress_history";

-- DropTable
DROP TABLE "public"."project_funding_sources";

-- DropTable
DROP TABLE "public"."projects";

-- DropTable
DROP TABLE "public"."proposals";

-- DropTable
DROP TABLE "public"."purchase_items";

-- DropTable
DROP TABLE "public"."reference_items";

-- DropTable
DROP TABLE "public"."reference_requests";

-- DropTable
DROP TABLE "public"."schedule_events";

-- DropTable
DROP TABLE "public"."settings";

-- DropTable
DROP TABLE "public"."stored_files";

-- DropTable
DROP TABLE "public"."task_assignees";

-- DropTable
DROP TABLE "public"."task_departments";

-- DropTable
DROP TABLE "public"."task_dependencies";

-- DropTable
DROP TABLE "public"."tasks";

-- DropTable
DROP TABLE "public"."terms";

-- DropTable
DROP TABLE "public"."users";

