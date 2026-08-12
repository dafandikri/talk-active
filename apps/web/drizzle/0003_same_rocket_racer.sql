ALTER TABLE "attempts" ADD COLUMN "legacy_title" varchar(200);--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "legacy_evidence_coverage" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "legacy_weakest" varchar(200);--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "legacy_defense_status" varchar(20);--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_legacy_coverage_domain" CHECK ("attempts"."legacy_evidence_coverage" is null or ("attempts"."legacy_evidence_coverage" >= 0 and "attempts"."legacy_evidence_coverage" <= 100));