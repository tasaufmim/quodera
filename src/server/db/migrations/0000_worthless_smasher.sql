CREATE TABLE "tenancy_canary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
