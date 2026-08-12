CREATE TYPE "public"."question_basis" AS ENUM('transcript', 'missing-evidence', 'source-document', 'legacy-unknown');--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "basis" "question_basis" DEFAULT 'legacy-unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "source_document_id" uuid;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "content_type" varchar(100) DEFAULT 'text/plain' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
UPDATE "source_documents" SET "size_bytes" = 1 WHERE "size_bytes" IS NULL;--> statement-breakpoint
ALTER TABLE "source_documents" ALTER COLUMN "size_bytes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_source_basis_consistent" CHECK (("questions"."basis" = 'source-document') = ("questions"."source_document_id" is not null));--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_size_domain" CHECK ("source_documents"."size_bytes" > 0 and "source_documents"."size_bytes" <= 40000);--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_content_type_allowed" CHECK ("source_documents"."content_type" in ('text/plain', 'text/markdown', 'application/json'));
