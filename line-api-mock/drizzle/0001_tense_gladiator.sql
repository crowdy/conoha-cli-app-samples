CREATE TABLE "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"coupon_id" text NOT NULL,
	"channel_id" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_coupon_id_unique" UNIQUE("coupon_id")
);
--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;