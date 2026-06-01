DROP TABLE IF EXISTS "provider_credentials";--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"tenant_id" varchar(256) NOT NULL,
	"id" varchar(256) NOT NULL,
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
	CONSTRAINT "provider_credentials_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "provider_credentials_id_unique" UNIQUE("id"),
	CONSTRAINT "provider_credentials_provider_unique" UNIQUE("tenant_id","provider","label")
);
--> statement-breakpoint
CREATE INDEX "provider_credentials_provider_idx" ON "provider_credentials" USING btree ("tenant_id","provider");
