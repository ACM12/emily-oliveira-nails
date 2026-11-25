CREATE TYPE "booking_status" AS ENUM('awaiting', 'confirmed', 'cancelled', 'blocked', 'review');--> statement-breakpoint
CREATE TABLE "booking_limits" (
	"key" text PRIMARY KEY,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY,
	"starts_at" timestamp with time zone NOT NULL,
	"status" "booking_status" NOT NULL,
	"customer_id" uuid,
	"service_name" text,
	"total_cents" integer,
	"deposit_cents" integer,
	"expires_at" timestamp with time zone,
	"payment_id" text UNIQUE,
	"pix_code" text,
	"pix_image" text,
	"next_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_amount_valid" CHECK ("status" = 'blocked' OR ("deposit_cents" > 0 AND "deposit_cents" * 2 = "total_cents"))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_active_per_slot" ON "bookings" ("starts_at") WHERE status IN ('awaiting', 'confirmed', 'blocked');--> statement-breakpoint
CREATE INDEX "bookings_starts_at_idx" ON "bookings" ("starts_at");--> statement-breakpoint
CREATE INDEX "bookings_payment_queue_idx" ON "bookings" ("next_check_at") WHERE status = 'awaiting';--> statement-breakpoint
CREATE UNIQUE INDEX "customers_contact_unique" ON "customers" ("email","phone");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id");