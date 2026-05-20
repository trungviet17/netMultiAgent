CREATE TABLE "provider_credentials" (
	"tenant_id" varchar(256) NOT NULL,
	"id" varchar(256) NOT NULL,
	"project_id" varchar(256) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"label" varchar(256),
	"base_url" varchar(512),
	"encrypted_key" text NOT NULL,
	"encryption_iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_fingerprint" varchar(32) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_test_status" varchar(32),
	"last_test_message" text,
	"last_tested_at" timestamp,
	"created_by" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "provider_credentials_tenant_id_project_id_id_pk" PRIMARY KEY("tenant_id","project_id","id"),
	CONSTRAINT "provider_credentials_id_unique" UNIQUE("id"),
	CONSTRAINT "provider_credentials_provider_unique" UNIQUE("tenant_id","project_id","provider","label")
);
--> statement-breakpoint
ALTER TABLE "webhook_destinations" ALTER COLUMN "headers" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_credentials_provider_idx" ON "provider_credentials" USING btree ("tenant_id","project_id","provider");