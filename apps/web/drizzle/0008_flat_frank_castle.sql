CREATE TYPE "public"."project_language" AS ENUM('id-ID', 'en-US');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "language" "project_language" DEFAULT 'id-ID' NOT NULL;