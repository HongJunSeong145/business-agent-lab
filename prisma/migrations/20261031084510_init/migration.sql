-- CreateTable
CREATE TABLE "councils" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "university" TEXT NOT NULL,
    "college" TEXT NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "councils_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terms" (
    "id" UUID NOT NULL,
    "council_id" UUID NOT NULL,
    "term_number" INTEGER NOT NULL,
    "name" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "banner_image_key" TEXT,
    "banner_title" TEXT,
    "banner_subtitle" TEXT,
    "q1_start" DATE NOT NULL,
    "q1_end" DATE NOT NULL,
    "q2_start" DATE NOT NULL,
    "q2_end" DATE NOT NULL,
    "q3_start" DATE NOT NULL,
    "q3_end" DATE NOT NULL,
    "q4_start" DATE NOT NULL,
    "q4_end" DATE NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_ko" TEXT NOT NULL,
    "color_hex" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "display_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "last_login_at" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6),
    "session_version" INTEGER NOT NULL DEFAULT 0,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "department_id" UUID,
    "role" TEXT NOT NULL,
    "position_title" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_profiles" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "user_id" UUID,
    "position_title" TEXT,
    "name" TEXT NOT NULL,
    "major" TEXT,
    "student_id" TEXT,
    "phone" TEXT,
    "gmail" TEXT,
    "school_email" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "member_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "term_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "department_id" UUID,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "invited_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL,
    "email_hash" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "meeting_date" DATE NOT NULL,
    "meeting_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "uploaded_by" UUID NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_files" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "storage_key" TEXT,
    "original_name" TEXT,
    "mime" TEXT,
    "size" BIGINT,
    "sha256" TEXT,
    "extracted_text" TEXT,
    "extraction_method" TEXT,
    "extraction_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "meeting_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_analyses" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "model" TEXT,
    "prompt_version" TEXT,
    "created_by_job_id" UUID,
    "edited_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "meeting_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "kind" TEXT NOT NULL,
    "target_id" UUID,
    "project_key" TEXT,
    "payload" JSONB NOT NULL,
    "before_snapshot" JSONB,
    "evidence" JSONB,
    "inferred" BOOLEAN NOT NULL DEFAULT false,
    "inference_reason" TEXT,
    "confidence" DECIMAL(4,3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "dedupe_key" TEXT NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'event',
    "status" TEXT NOT NULL DEFAULT 'planning',
    "event_start" DATE,
    "event_end" DATE,
    "venue" TEXT,
    "expected_beneficiaries" INTEGER,
    "host" TEXT,
    "organizer" TEXT,
    "uses_external_vendor" BOOLEAN NOT NULL DEFAULT false,
    "promo_tier" TEXT,
    "dept_weight_override" JSONB,
    "quarter" INTEGER,
    "created_from_meeting_id" UUID,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_funding_sources" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "amount_planned" BIGINT NOT NULL DEFAULT 0,
    "amount_actual" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_funding_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_events" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "project_id" UUID,
    "task_id" UUID,
    "title" TEXT NOT NULL,
    "start" TIMESTAMPTZ(6) NOT NULL,
    "end" TIMESTAMPTZ(6),
    "all_day" BOOLEAN NOT NULL DEFAULT true,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'proposed',
    "origin" TEXT NOT NULL,
    "rule_key" TEXT,
    "color_department_id" UUID,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "schedule_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "template_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "due_date" DATE,
    "due_time" TIME(0),
    "due_state" TEXT NOT NULL DEFAULT 'proposed',
    "due_reason" TEXT,
    "due_feasible" BOOLEAN NOT NULL DEFAULT true,
    "start_date" DATE,
    "weight" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "ai_progress" INTEGER,
    "manual_progress" INTEGER,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_by" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "needs_reference" BOOLEAN NOT NULL DEFAULT false,
    "acceptance_criteria" JSONB,
    "allow_draft_start" BOOLEAN NOT NULL DEFAULT false,
    "started_on_draft_plan" BOOLEAN NOT NULL DEFAULT false,
    "source_proposal_id" UUID,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_departments" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "task_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignees" (
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("task_id","user_id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "depends_on_task_id" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'finish_to_start',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_history" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "actor" TEXT NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "evaluation_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "progress_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" JSONB,
    "parent_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverables" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "current_version_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverable_versions" (
    "id" UUID NOT NULL,
    "deliverable_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "storage_key" TEXT,
    "external_url" TEXT,
    "mime" TEXT,
    "size" BIGINT,
    "sha256" TEXT,
    "note" TEXT,
    "uploaded_by" UUID NOT NULL,
    "extracted_text" TEXT,
    "thumbnail_key" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "deliverable_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_evaluations" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "deliverable_version_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "rubric_results" JSONB NOT NULL,
    "missing_items" JSONB,
    "suggestions" JSONB,
    "model" TEXT,
    "prompt_version" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "progress_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "current_version_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_versions" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "fields" JSONB NOT NULL,
    "file_key" TEXT,
    "author_id" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_items" (
    "id" UUID NOT NULL,
    "task_id" UUID,
    "project_id" UUID,
    "department_id" UUID,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "storage_key" TEXT,
    "summary" TEXT,
    "relevance_note" TEXT,
    "origin" TEXT NOT NULL,
    "request_id" UUID,
    "needs_review_before_send" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reference_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_requests" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "instruction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "context_snapshot" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reference_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_periods" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "quarter" INTEGER NOT NULL,
    "review_group" TEXT NOT NULL,
    "budget_status" TEXT NOT NULL DEFAULT 'draft',
    "settlement_status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "budget_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" UUID NOT NULL,
    "budget_period_id" UUID NOT NULL,
    "project_id" UUID,
    "funding_source" TEXT,
    "category" TEXT,
    "item" TEXT NOT NULL,
    "planned_amount" BIGINT NOT NULL DEFAULT 0,
    "actual_amount" BIGINT,
    "tax_amount" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unit_price" BIGINT NOT NULL DEFAULT 0,
    "vendor" TEXT,
    "funding_source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'listed',
    "purchased_at" TIMESTAMPTZ(6),
    "purchased_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_requirements" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "rule_source" TEXT,
    "due_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "evidence_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_items" (
    "id" UUID NOT NULL,
    "requirement_id" UUID,
    "project_id" UUID NOT NULL,
    "purchase_item_id" UUID,
    "storage_key" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "note" TEXT,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "evidence_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_columns" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "options" JSONB,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contact_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_rows" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "category" TEXT NOT NULL DEFAULT '기타',
    "data" JSONB NOT NULL DEFAULT '{}',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contact_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_leads" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "contact_row_id" UUID,
    "company_name" TEXT NOT NULL,
    "website" TEXT,
    "contact_channel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "last_contact_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "partner_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "department_id" UUID,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "read_at" TIMESTAMPTZ(6),
    "dedupe_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_kind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "diff" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_jobs" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "idempotency_key" TEXT NOT NULL,
    "pgboss_job_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL,
    "job_id" UUID,
    "agent" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "latency_ms" INTEGER,
    "cost_estimate_krw" DECIMAL(12,2),
    "output_valid" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mime" TEXT,
    "size" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "terms_council_id_term_number_key" ON "terms"("council_id", "term_number");

-- CreateIndex
CREATE UNIQUE INDEX "departments_term_id_code_key" ON "departments"("term_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_term_id_key" ON "memberships"("user_id", "term_id");

-- CreateIndex
CREATE INDEX "member_profiles_term_id_display_order_idx" ON "member_profiles"("term_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "login_attempts_email_hash_created_at_idx" ON "login_attempts"("email_hash", "created_at");

-- CreateIndex
CREATE INDEX "login_attempts_ip_created_at_idx" ON "login_attempts"("ip", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "settings_term_id_key_key" ON "settings"("term_id", "key");

-- CreateIndex
CREATE INDEX "meetings_term_id_meeting_date_idx" ON "meetings"("term_id", "meeting_date");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_analyses_meeting_id_version_key" ON "meeting_analyses"("meeting_id", "version");

-- CreateIndex
CREATE INDEX "proposals_term_id_status_idx" ON "proposals"("term_id", "status");

-- CreateIndex
CREATE INDEX "proposals_source_type_source_id_idx" ON "proposals"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "projects_term_id_event_start_idx" ON "projects"("term_id", "event_start");

-- CreateIndex
CREATE UNIQUE INDEX "project_funding_sources_project_id_source_key" ON "project_funding_sources"("project_id", "source");

-- CreateIndex
CREATE INDEX "schedule_events_term_id_start_idx" ON "schedule_events"("term_id", "start");

-- CreateIndex
CREATE INDEX "tasks_project_id_idx" ON "tasks"("project_id");

-- CreateIndex
CREATE INDEX "tasks_due_date_idx" ON "tasks"("due_date");

-- CreateIndex
CREATE INDEX "task_departments_department_id_idx" ON "task_departments"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_departments_task_id_department_id_key" ON "task_departments"("task_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_task_id_depends_on_task_id_key" ON "task_dependencies"("task_id", "depends_on_task_id");

-- CreateIndex
CREATE INDEX "progress_history_task_id_created_at_idx" ON "progress_history"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_task_id_created_at_idx" ON "comments"("task_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "deliverable_versions_deliverable_id_version_no_key" ON "deliverable_versions"("deliverable_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "plans_project_id_key" ON "plans"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_versions_plan_id_version_no_key" ON "plan_versions"("plan_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "budget_periods_term_id_quarter_key" ON "budget_periods"("term_id", "quarter");

-- CreateIndex
CREATE UNIQUE INDEX "contact_columns_term_id_key_key" ON "contact_columns"("term_id", "key");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "activity_logs_entity_type_entity_id_idx" ON "activity_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_jobs_idempotency_key_key" ON "ai_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_runs_created_at_idx" ON "ai_runs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_storage_key_key" ON "stored_files"("storage_key");

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_council_id_fkey" FOREIGN KEY ("council_id") REFERENCES "councils"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_files" ADD CONSTRAINT "meeting_files_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_analyses" ADD CONSTRAINT "meeting_analyses_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_analyses" ADD CONSTRAINT "meeting_analyses_created_by_job_id_fkey" FOREIGN KEY ("created_by_job_id") REFERENCES "ai_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_from_meeting_id_fkey" FOREIGN KEY ("created_from_meeting_id") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_funding_sources" ADD CONSTRAINT "project_funding_sources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_events" ADD CONSTRAINT "schedule_events_color_department_id_fkey" FOREIGN KEY ("color_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_proposal_id_fkey" FOREIGN KEY ("source_proposal_id") REFERENCES "proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_departments" ADD CONSTRAINT "task_departments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_departments" ADD CONSTRAINT "task_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_fkey" FOREIGN KEY ("depends_on_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_history" ADD CONSTRAINT "progress_history_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_deliverable_id_fkey" FOREIGN KEY ("deliverable_id") REFERENCES "deliverables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_evaluations" ADD CONSTRAINT "progress_evaluations_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_evaluations" ADD CONSTRAINT "progress_evaluations_deliverable_version_id_fkey" FOREIGN KEY ("deliverable_version_id") REFERENCES "deliverable_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_items" ADD CONSTRAINT "reference_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_items" ADD CONSTRAINT "reference_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_items" ADD CONSTRAINT "reference_items_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_items" ADD CONSTRAINT "reference_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "reference_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_requests" ADD CONSTRAINT "reference_requests_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_period_id_fkey" FOREIGN KEY ("budget_period_id") REFERENCES "budget_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_requirements" ADD CONSTRAINT "evidence_requirements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "evidence_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_purchase_item_id_fkey" FOREIGN KEY ("purchase_item_id") REFERENCES "purchase_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_columns" ADD CONSTRAINT "contact_columns_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_rows" ADD CONSTRAINT "contact_rows_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_leads" ADD CONSTRAINT "partner_leads_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_leads" ADD CONSTRAINT "partner_leads_contact_row_id_fkey" FOREIGN KEY ("contact_row_id") REFERENCES "contact_rows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- 수동 보강 (ADR-006/007): CHECK 제약, 부분 고유 인덱스, 생성 컬럼
-- ═══════════════════════════════════════════════════════════════════

-- effective_progress: D3 공식은 뷰로만 제공 (직접 수정 불가, ADR-007)
CREATE VIEW "task_progress" AS
  SELECT "id" AS "task_id",
         CASE WHEN "is_completed" THEN 100 ELSE COALESCE("manual_progress", "ai_progress", 0) END AS "effective_progress"
  FROM "tasks";

-- 조직·사용자
ALTER TABLE "terms" ADD CONSTRAINT "terms_dates_chk" CHECK (
  "start_date" <= "end_date"
  AND "q1_start" <= "q1_end" AND "q1_end" < "q2_start"
  AND "q2_start" <= "q2_end" AND "q2_end" < "q3_start"
  AND "q3_start" <= "q3_end" AND "q3_end" < "q4_start"
  AND "q4_start" <= "q4_end");
CREATE UNIQUE INDEX "terms_one_current_per_council" ON "terms"("council_id") WHERE "is_current";
ALTER TABLE "departments" ADD CONSTRAINT "departments_code_chk" CHECK ("code" IN ('planning','finance','secretariat','promotion','operations'));
ALTER TABLE "departments" ADD CONSTRAINT "departments_color_chk" CHECK ("color_hex" ~ '^#[0-9A-Fa-f]{6}$');
ALTER TABLE "users" ADD CONSTRAINT "users_status_chk" CHECK ("status" IN ('invited','active','disabled'));
ALTER TABLE "users" ADD CONSTRAINT "users_email_lower_chk" CHECK ("email" = lower("email"));
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_chk" CHECK ("role" IN ('admin','president','head','member'));
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_dept_required_chk" CHECK ("role" NOT IN ('head','member') OR "department_id" IS NOT NULL);
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_chk" CHECK ("role" IN ('admin','president','head','member'));

-- 회의록
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_type_chk" CHECK ("meeting_type" IN ('regular','extraordinary','department','other'));
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_source_chk" CHECK ("source" IN ('upload','paste','manual'));
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_status_chk" CHECK ("status" IN ('uploaded','extracting','extracted','analyzing','analyzed','reviewed','failed'));

-- 제안
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_source_chk" CHECK ("source_type" IN ('meeting','manual','monitor'));
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_kind_chk" CHECK ("kind" IN ('new_project','update_project','new_task','update_task','deadline','dependency','cancel'));
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_status_chk" CHECK ("status" IN ('pending','approved','edited_approved','rejected','superseded'));
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_confidence_chk" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));
CREATE UNIQUE INDEX "proposals_pending_dedupe" ON "proposals"("dedupe_key") WHERE "status" = 'pending';

-- 사업·일정
ALTER TABLE "projects" ADD CONSTRAINT "projects_category_chk" CHECK ("category" IN ('event','promotion','partnership','welfare','admin','other'));
ALTER TABLE "projects" ADD CONSTRAINT "projects_status_chk" CHECK ("status" IN ('proposed','planning','approved','in_progress','done','cancelled','postponed'));
ALTER TABLE "projects" ADD CONSTRAINT "projects_promo_tier_chk" CHECK ("promo_tier" IS NULL OR "promo_tier" IN ('free','low','high'));
ALTER TABLE "projects" ADD CONSTRAINT "projects_quarter_chk" CHECK ("quarter" IS NULL OR "quarter" BETWEEN 1 AND 4);
ALTER TABLE "projects" ADD CONSTRAINT "projects_event_dates_chk" CHECK ("event_end" IS NULL OR "event_start" IS NULL OR "event_start" <= "event_end");
ALTER TABLE "projects" ADD CONSTRAINT "projects_beneficiaries_chk" CHECK ("expected_beneficiaries" IS NULL OR "expected_beneficiaries" >= 0);
ALTER TABLE "project_funding_sources" ADD CONSTRAINT "pfs_source_chk" CHECK ("source" IN ('school','student_fee'));
ALTER TABLE "project_funding_sources" ADD CONSTRAINT "pfs_amount_chk" CHECK ("amount_planned" >= 0 AND ("amount_actual" IS NULL OR "amount_actual" >= 0));
ALTER TABLE "schedule_events" ADD CONSTRAINT "se_kind_chk" CHECK ("kind" IN ('event_day','deadline','milestone','meeting','custom'));
ALTER TABLE "schedule_events" ADD CONSTRAINT "se_state_chk" CHECK ("state" IN ('proposed','confirmed'));
ALTER TABLE "schedule_events" ADD CONSTRAINT "se_origin_chk" CHECK ("origin" IN ('ai','user','rule'));

-- 업무
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_chk" CHECK ("status" IN ('blocked','todo','in_progress','review','done','cancelled'));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_due_state_chk" CHECK ("due_state" IN ('proposed','confirmed'));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ai_progress_chk" CHECK ("ai_progress" IS NULL OR "ai_progress" BETWEEN 0 AND 100);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_manual_progress_chk" CHECK ("manual_progress" IS NULL OR "manual_progress" BETWEEN 0 AND 100);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_weight_chk" CHECK ("weight" > 0);
ALTER TABLE "task_departments" ADD CONSTRAINT "td_role_chk" CHECK ("role" IN ('lead','support'));
CREATE UNIQUE INDEX "task_departments_one_lead" ON "task_departments"("task_id") WHERE "role" = 'lead';
ALTER TABLE "task_dependencies" ADD CONSTRAINT "tdep_type_chk" CHECK ("type" IN ('finish_to_start','approval_required','draft_ok'));
ALTER TABLE "task_dependencies" ADD CONSTRAINT "tdep_no_self_chk" CHECK ("task_id" <> "depends_on_task_id");
ALTER TABLE "progress_history" ADD CONSTRAINT "ph_field_chk" CHECK ("field" IN ('ai','manual','completed'));
ALTER TABLE "progress_history" ADD CONSTRAINT "ph_actor_chk" CHECK ("actor" IN ('user','ai'));

-- 작업물·기획안·레퍼런스
ALTER TABLE "deliverable_versions" ADD CONSTRAINT "dv_source_chk" CHECK (("storage_key" IS NULL) <> ("external_url" IS NULL));
ALTER TABLE "progress_evaluations" ADD CONSTRAINT "pe_score_chk" CHECK ("score" BETWEEN 1 AND 100);
ALTER TABLE "plans" ADD CONSTRAINT "plans_status_chk" CHECK ("status" IN ('draft','submitted','approved','rejected'));
ALTER TABLE "reference_items" ADD CONSTRAINT "ri_kind_chk" CHECK ("kind" IN ('link','file','ai_example'));
ALTER TABLE "reference_items" ADD CONSTRAINT "ri_origin_chk" CHECK ("origin" IN ('user','ai_search','ai_generated'));
ALTER TABLE "reference_requests" ADD CONSTRAINT "rr_status_chk" CHECK ("status" IN ('queued','running','done','failed'));

-- 재정
ALTER TABLE "budget_periods" ADD CONSTRAINT "bp_quarter_chk" CHECK ("quarter" BETWEEN 1 AND 4);
ALTER TABLE "budget_periods" ADD CONSTRAINT "bp_group_chk" CHECK ("review_group" = CASE WHEN "quarter" <= 2 THEN 'A' ELSE 'B' END);
ALTER TABLE "budget_lines" ADD CONSTRAINT "bl_source_chk" CHECK ("funding_source" IS NULL OR "funding_source" IN ('school','student_fee'));
ALTER TABLE "purchase_items" ADD CONSTRAINT "pi_source_chk" CHECK ("funding_source" IS NULL OR "funding_source" IN ('school','student_fee'));
ALTER TABLE "purchase_items" ADD CONSTRAINT "pi_status_chk" CHECK ("status" IN ('listed','approved','purchased','cancelled'));
ALTER TABLE "purchase_items" ADD CONSTRAINT "pi_qty_chk" CHECK ("qty" > 0 AND "unit_price" >= 0);
ALTER TABLE "evidence_requirements" ADD CONSTRAINT "er_type_chk" CHECK ("type" IN ('receipt','photo','beneficiary_roster','official_letter','plan_doc','quote','transfer_record','other'));

-- 연락망·제휴
ALTER TABLE "contact_columns" ADD CONSTRAINT "cc_type_chk" CHECK ("type" IN ('text','phone','email','url','select'));
ALTER TABLE "partner_leads" ADD CONSTRAINT "pl_status_chk" CHECK ("status" IN ('candidate','contacted','replied','negotiating','confirmed','declined'));

-- 시스템
ALTER TABLE "notifications" ADD CONSTRAINT "n_severity_chk" CHECK ("severity" IN ('info','warn','critical'));
ALTER TABLE "activity_logs" ADD CONSTRAINT "al_actor_kind_chk" CHECK ("actor_kind" IN ('user','ai','system'));
ALTER TABLE "ai_jobs" ADD CONSTRAINT "aj_status_chk" CHECK ("status" IN ('queued','running','succeeded','failed','waiting_budget'));
