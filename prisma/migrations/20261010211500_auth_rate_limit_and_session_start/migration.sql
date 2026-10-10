-- Sign-in rate limits, and a fixed session start so activity cannot extend the 7-day cap.
-- auth_rate_limits is a normal table. Default privileges already grant the app role
-- read and write. The grants below keep that explicit.

ALTER TABLE "sessions" ADD COLUMN "createdAt" TIMESTAMP(3);

UPDATE "sessions"
SET "createdAt" = "expires" - INTERVAL '7 days'
WHERE "createdAt" IS NULL;

ALTER TABLE "sessions" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "sessions" ALTER COLUMN "createdAt" SET NOT NULL;

CREATE TABLE "auth_rate_limits" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("key")
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "auth_rate_limits" TO avanza_hrms_app;
