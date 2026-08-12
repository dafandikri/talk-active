CREATE TYPE "public"."attempt_mode" AS ENUM('typed', 'dictated');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('draft', 'analysing', 'review', 'defending', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."evidence_engine" AS ENUM('semantic', 'deterministic');--> statement-breakpoint
CREATE TYPE "public"."evidence_stage" AS ENUM('initial', 'defense');--> statement-breakpoint
CREATE TYPE "public"."evidence_verdict" AS ENUM('supported', 'partial', 'unsupported');--> statement-breakpoint
CREATE TYPE "public"."rubric_source" AS ENUM('manual', 'imported', 'library');--> statement-breakpoint
CREATE TYPE "public"."transcript_source" AS ENUM('typed', 'web-speech', 'imported');--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"mode" "attempt_mode" NOT NULL,
	"status" "attempt_status" DEFAULT 'draft' NOT NULL,
	"transcript" text DEFAULT '' NOT NULL,
	"transcript_source" "transcript_source" NOT NULL,
	"duration_seconds" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "attempts_duration_positive" CHECK ("attempts"."duration_seconds" > 0),
	CONSTRAINT "attempts_transcript_length" CHECK (char_length("attempts"."transcript") <= 12000)
);
--> statement-breakpoint
CREATE TABLE "criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rubric_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"required_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"display_order" integer NOT NULL,
	CONSTRAINT "criteria_display_order_nonnegative" CHECK ("criteria"."display_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "defense_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"answer_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"stage" "evidence_stage" NOT NULL,
	"verdict" "evidence_verdict" NOT NULL,
	"coverage_score" numeric(2, 1) NOT NULL,
	"cited_span" text,
	"missing_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"engine" "evidence_engine" NOT NULL,
	"verifier_agreed" boolean,
	"verifier_note" text,
	"student_overridden" boolean DEFAULT false NOT NULL,
	"student_override_verdict" "evidence_verdict",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_verdicts_coverage_domain" CHECK ("evidence_verdicts"."coverage_score" in (0, 0.5, 1)),
	CONSTRAINT "evidence_verdicts_supported_has_span" CHECK ("evidence_verdicts"."verdict" <> 'supported' or char_length(trim("evidence_verdicts"."cited_span")) > 0),
	CONSTRAINT "evidence_verdicts_unsupported_has_gap" CHECK ("evidence_verdicts"."verdict" <> 'unsupported' or jsonb_array_length("evidence_verdicts"."missing_evidence") > 0),
	CONSTRAINT "evidence_verdicts_override_consistent" CHECK ("evidence_verdicts"."student_overridden" = ("evidence_verdicts"."student_override_verdict" is not null))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"title" varchar(160) NOT NULL,
	"event_context" text,
	"deadline" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"target_criterion_id" uuid NOT NULL,
	"question_text" text NOT NULL,
	"challenged_claim" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source_type" "rubric_source" NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"blob_url" text NOT NULL,
	"filename" varchar(255) NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criteria" ADD CONSTRAINT "criteria_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defense_answers" ADD CONSTRAINT "defense_answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_verdicts" ADD CONSTRAINT "evidence_verdicts_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_verdicts" ADD CONSTRAINT "evidence_verdicts_criterion_id_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."criteria"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_target_criterion_id_criteria_id_fk" FOREIGN KEY ("target_criterion_id") REFERENCES "public"."criteria"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempts_project_created_at_idx" ON "attempts" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "criteria_rubric_order_unique" ON "criteria" USING btree ("rubric_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "defense_answers_question_unique" ON "defense_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "evidence_verdicts_attempt_idx" ON "evidence_verdicts" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "evidence_verdicts_criterion_idx" ON "evidence_verdicts" USING btree ("criterion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_verdicts_attempt_criterion_stage_unique" ON "evidence_verdicts" USING btree ("attempt_id","criterion_id","stage");--> statement-breakpoint
CREATE INDEX "projects_user_id_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_updated_at_idx" ON "projects" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_attempt_unique" ON "questions" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rubrics_project_id_unique" ON "rubrics" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "source_documents_project_idx" ON "source_documents" USING btree ("project_id");