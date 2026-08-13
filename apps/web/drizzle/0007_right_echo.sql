CREATE TYPE "public"."delivery_event_source" AS ENUM('acoustic', 'interim-transcript', 'combined', 'vision');--> statement-breakpoint
CREATE TYPE "public"."recording_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."vision_mode" AS ENUM('interview', 'presentation');--> statement-breakpoint
CREATE TABLE "attempt_delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"source" "delivery_event_source" NOT NULL,
	"kind" varchar(64) NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"label" varchar(200) NOT NULL,
	"evidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempt_delivery_events_time_order" CHECK ("attempt_delivery_events"."end_ms" >= "attempt_delivery_events"."start_ms"),
	CONSTRAINT "attempt_delivery_events_time_domain" CHECK ("attempt_delivery_events"."start_ms" >= 0 and "attempt_delivery_events"."end_ms" <= 3600000),
	CONSTRAINT "attempt_delivery_events_evidence_length" CHECK (char_length("attempt_delivery_events"."evidence") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "attempt_delivery_reviews" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"mode" "vision_mode" NOT NULL,
	"vocal_score" integer NOT NULL,
	"visual_score" integer,
	"tracking_coverage_percent" integer,
	"filler_count" integer NOT NULL,
	"repeated_word_count" integer NOT NULL,
	"boundary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempt_delivery_reviews_vocal_score_domain" CHECK ("attempt_delivery_reviews"."vocal_score" between 0 and 100),
	CONSTRAINT "attempt_delivery_reviews_visual_score_domain" CHECK ("attempt_delivery_reviews"."visual_score" is null or "attempt_delivery_reviews"."visual_score" between 0 and 100),
	CONSTRAINT "attempt_delivery_reviews_tracking_domain" CHECK ("attempt_delivery_reviews"."tracking_coverage_percent" is null or "attempt_delivery_reviews"."tracking_coverage_percent" between 0 and 100),
	CONSTRAINT "attempt_delivery_reviews_counts_nonnegative" CHECK ("attempt_delivery_reviews"."filler_count" >= 0 and "attempt_delivery_reviews"."repeated_word_count" >= 0),
	CONSTRAINT "attempt_delivery_reviews_boundary_length" CHECK (char_length("attempt_delivery_reviews"."boundary") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "attempt_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"status" "recording_status" DEFAULT 'pending' NOT NULL,
	"blob_url" text,
	"pathname" text NOT NULL,
	"content_type" varchar(32) NOT NULL,
	"size_bytes" integer,
	"duration_ms" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone,
	CONSTRAINT "attempt_recordings_size_domain" CHECK ("attempt_recordings"."size_bytes" is null or ("attempt_recordings"."size_bytes" > 0 and "attempt_recordings"."size_bytes" <= 250000000)),
	CONSTRAINT "attempt_recordings_duration_domain" CHECK ("attempt_recordings"."duration_ms" > 0 and "attempt_recordings"."duration_ms" <= 3600000),
	CONSTRAINT "attempt_recordings_content_type_allowed" CHECK ("attempt_recordings"."content_type" in ('video/webm', 'video/mp4')),
	CONSTRAINT "attempt_recordings_ready_metadata_consistent" CHECK (("attempt_recordings"."status" = 'ready') = ("attempt_recordings"."blob_url" is not null and "attempt_recordings"."size_bytes" is not null and "attempt_recordings"."uploaded_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "attempt_delivery_events" ADD CONSTRAINT "attempt_delivery_events_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_delivery_reviews" ADD CONSTRAINT "attempt_delivery_reviews_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_recordings" ADD CONSTRAINT "attempt_recordings_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempt_delivery_events_attempt_start_idx" ON "attempt_delivery_events" USING btree ("attempt_id","start_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_recordings_attempt_id_unique" ON "attempt_recordings" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_recordings_pathname_unique" ON "attempt_recordings" USING btree ("pathname");