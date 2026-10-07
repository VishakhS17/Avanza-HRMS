-- CreateEnum
CREATE TYPE "AttendanceEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('WEB');

-- CreateEnum
CREATE TYPE "AttendanceMode" AS ENUM ('OFFICE', 'WFH');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'WFH', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "AttendanceFlag" AS ENUM ('LATE', 'EARLY_EXIT', 'INCOMPLETE');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "exitDate" DATE;

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'General',
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 15,
    "halfDayHours" DECIMAL(4,2) NOT NULL,
    "fullDayHours" DECIMAL(4,2) NOT NULL,
    "earlyCheckInMinutes" INTEGER NOT NULL DEFAULT 240,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_events" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "type" "AttendanceEventType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "AttendanceSource" NOT NULL DEFAULT 'WEB',
    "mode" "AttendanceMode" NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "locationId" TEXT,
    "status" "AttendanceStatus" NOT NULL,
    "flags" "AttendanceFlag"[],
    "firstIn" TIMESTAMP(3),
    "lastOut" TIMESTAMP(3),
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "mode" "AttendanceMode",
    "regularizationId" TEXT,
    "overriddenById" TEXT,
    "overrideReason" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_regularizations" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "requestedIn" TIMESTAMP(3) NOT NULL,
    "requestedOut" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "pendingKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "attendance_regularizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shifts_locationId_key" ON "shifts"("locationId");

-- CreateIndex
CREATE INDEX "attendance_events_employeeId_timestamp_idx" ON "attendance_events"("employeeId", "timestamp");

-- CreateIndex
CREATE INDEX "attendance_events_employeeId_workDate_idx" ON "attendance_events"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "attendance_events_workDate_idx" ON "attendance_events"("workDate");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_regularizationId_key" ON "attendance_records"("regularizationId");

-- CreateIndex
CREATE INDEX "attendance_records_workDate_status_idx" ON "attendance_records"("workDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_employeeId_workDate_key" ON "attendance_records"("employeeId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_regularizations_pendingKey_key" ON "attendance_regularizations"("pendingKey");

-- CreateIndex
CREATE INDEX "attendance_regularizations_employeeId_workDate_idx" ON "attendance_regularizations"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "attendance_regularizations_status_idx" ON "attendance_regularizations"("status");

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_regularizationId_fkey" FOREIGN KEY ("regularizationId") REFERENCES "attendance_regularizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_regularizations" ADD CONSTRAINT "attendance_regularizations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw punches are append-only, like audit_log. Default privileges from
-- 20261006201500_audit_log_app_role gave the app role full DML, so take it back.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "attendance_events" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avanza_hrms_app') THEN
    REVOKE ALL ON TABLE "attendance_events" FROM avanza_hrms_app;
    GRANT SELECT, INSERT ON TABLE "attendance_events" TO avanza_hrms_app;
  END IF;
END $$;

CREATE FUNCTION attendance_events_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'attendance_events is append-only';
END;
$$;

CREATE TRIGGER attendance_events_append_only
BEFORE UPDATE OR DELETE ON "attendance_events"
FOR EACH ROW
EXECUTE FUNCTION attendance_events_reject_mutation();

CREATE TRIGGER attendance_events_no_truncate
BEFORE TRUNCATE ON "attendance_events"
FOR EACH STATEMENT
EXECUTE FUNCTION attendance_events_reject_mutation();

-- Default General shift for every existing location: 09:30 to 18:30, 15 minutes grace.
INSERT INTO "shifts" ("id", "locationId", "name", "startTime", "endTime", "graceMinutes", "halfDayHours", "fullDayHours", "earlyCheckInMinutes", "updatedAt")
SELECT gen_random_uuid()::text, l."id", 'General', '09:30', '18:30', 15, 4.00, 8.00, 240, CURRENT_TIMESTAMP
FROM "locations" l
WHERE NOT EXISTS (SELECT 1 FROM "shifts" s WHERE s."locationId" = l."id");

-- Exit date for people who already exited: the day their user was deactivated (Asia/Kolkata).
UPDATE "employees" e
SET "exitDate" = ((COALESCE(u."statusChangedAt", e."updatedAt") AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date
FROM "users" u
WHERE u."id" = e."id" AND e."status" = 'EXITED' AND e."exitDate" IS NULL;
