CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"page" integer,
	"section" text,
	"paragraph_no" integer NOT NULL,
	"line_start" integer,
	"line_end" integer,
	"content" text NOT NULL,
	"embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_user_id_idx" ON "chunks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chunks_version_id_idx" ON "chunks" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "chunks_version_paragraph_idx" ON "chunks" USING btree ("version_id","paragraph_no");