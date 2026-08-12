CREATE TABLE "evidence_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_verdict_id" uuid NOT NULL,
	"accepted" boolean NOT NULL,
	"judged_verdict" "evidence_verdict" NOT NULL,
	"judged_coverage_score" numeric(2, 1) NOT NULL,
	"judged_cited_span" text,
	"judged_missing_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"judged_engine" "evidence_engine" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rejudged_at" timestamp with time zone,
	CONSTRAINT "evidence_confirmations_coverage_domain" CHECK ("evidence_confirmations"."judged_coverage_score" in (0, 0.5, 1)),
	CONSTRAINT "evidence_confirmations_supported_or_partial_has_span" CHECK ("evidence_confirmations"."judged_verdict" = 'unsupported' or char_length(trim("evidence_confirmations"."judged_cited_span")) > 0),
	CONSTRAINT "evidence_confirmations_unsupported_has_gap" CHECK ("evidence_confirmations"."judged_verdict" <> 'unsupported' or jsonb_array_length("evidence_confirmations"."judged_missing_evidence") > 0),
	CONSTRAINT "evidence_confirmations_acceptance_does_not_rejudge" CHECK (not "evidence_confirmations"."accepted" or "evidence_confirmations"."rejudged_at" is null)
);
--> statement-breakpoint
ALTER TABLE "evidence_confirmations" ADD CONSTRAINT "evidence_confirmations_evidence_verdict_id_evidence_verdicts_id_fk" FOREIGN KEY ("evidence_verdict_id") REFERENCES "public"."evidence_verdicts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_confirmations_verdict_unique" ON "evidence_confirmations" USING btree ("evidence_verdict_id");--> statement-breakpoint
CREATE INDEX "evidence_confirmations_created_at_idx" ON "evidence_confirmations" USING btree ("created_at");