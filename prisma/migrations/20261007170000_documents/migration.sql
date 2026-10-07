-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('EMPLOYEE_ONLY', 'HR_ONLY', 'EMPLOYEE_AND_HR');

-- CreateEnum
CREATE TYPE "DocumentUploader" AS ENUM ('EMPLOYEE', 'HR');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateTable
CREATE TABLE "document_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "uploader" "DocumentUploader" NOT NULL,
    "defaultVisibility" "DocumentVisibility" NOT NULL,
    "isSensitive" BOOLEAN NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "document_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "DocumentVisibility",
    "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "expiresOn" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "removedById" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_assignments" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "onBehalfNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_acknowledgements" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,

    CONSTRAINT "document_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_categories_code_key" ON "document_categories"("code");

-- CreateIndex
CREATE INDEX "documents_categoryId_status_idx" ON "documents"("categoryId", "status");

-- CreateIndex
CREATE INDEX "documents_createdById_idx" ON "documents"("createdById");

-- CreateIndex
CREATE INDEX "document_assignments_employeeId_idx" ON "document_assignments"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "document_assignments_documentId_employeeId_key" ON "document_assignments"("documentId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_storageKey_key" ON "document_versions"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_versionNumber_key" ON "document_versions"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "document_acknowledgements_userId_idx" ON "document_acknowledgements"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "document_acknowledgements_versionId_userId_key" ON "document_acknowledgements"("versionId", "userId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "document_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fixed categories. Employee categories: the employee uploads, or HR on their behalf with a note.
INSERT INTO "document_categories" ("id", "code", "name", "uploader", "defaultVisibility", "isSensitive", "sortOrder") VALUES
  ('doccat_identity', 'IDENTITY', 'Identity', 'EMPLOYEE', 'EMPLOYEE_AND_HR', true, 1),
  ('doccat_address', 'ADDRESS', 'Address', 'EMPLOYEE', 'EMPLOYEE_AND_HR', true, 2),
  ('doccat_education', 'EDUCATION', 'Education', 'EMPLOYEE', 'EMPLOYEE_AND_HR', true, 3),
  ('doccat_certificates', 'CERTIFICATES', 'Certificates', 'EMPLOYEE', 'EMPLOYEE_AND_HR', true, 4),
  ('doccat_employment', 'EMPLOYMENT', 'Employment', 'HR', 'EMPLOYEE_AND_HR', true, 5),
  ('doccat_payslips', 'PAYSLIPS', 'Payslips', 'HR', 'EMPLOYEE_AND_HR', true, 6),
  ('doccat_policies', 'POLICIES', 'Policies', 'HR', 'EMPLOYEE_AND_HR', false, 7),
  ('doccat_other_hr', 'OTHER_HR', 'Other HR', 'HR', 'HR_ONLY', true, 8);

-- Versions and acknowledgements are facts once written. Default privileges from
-- 20261006201500_audit_log_app_role gave the app role full DML, so take it back.
-- Categories are reference data the app only reads.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "document_versions", "document_acknowledgements" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avanza_hrms_app') THEN
    REVOKE ALL ON TABLE "document_versions", "document_acknowledgements", "document_categories" FROM avanza_hrms_app;
    GRANT SELECT, INSERT ON TABLE "document_versions", "document_acknowledgements" TO avanza_hrms_app;
    GRANT SELECT ON TABLE "document_categories" TO avanza_hrms_app;
  END IF;
END $$;
