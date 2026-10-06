-- The running app and the tests connect as avanza_hrms_app (DATABASE_URL).
-- Migrations run as the owner role (DIRECT_URL). On Neon the owner is a member of
-- neon_superuser, which inherits pg_write_all_data, so the owner can always UPDATE and
-- DELETE audit_log whatever the table ACL says. The app role must not own any table and
-- must not be a member of the owner role or neon_superuser.
--
-- This migration creates the role without LOGIN. `npm run db:roles` turns on LOGIN and
-- sets the password, so no secret is stored here.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avanza_hrms_app') THEN
    CREATE ROLE avanza_hrms_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO avanza_hrms_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO avanza_hrms_app;

-- Normal tables: read and write. TRUNCATE is never granted.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO avanza_hrms_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO avanza_hrms_app;

-- Prisma's own bookkeeping is for the owner only.
REVOKE ALL ON TABLE "_prisma_migrations" FROM avanza_hrms_app;

-- audit_log: read and insert only.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log" FROM PUBLIC;
REVOKE ALL ON TABLE "audit_log" FROM avanza_hrms_app;
GRANT SELECT, INSERT ON TABLE "audit_log" TO avanza_hrms_app;

-- Tables and sequences created by later migrations (run as this same owner role).
-- TRUNCATE is not in the default grant. A new append-only table must revoke UPDATE and
-- DELETE from avanza_hrms_app in its own migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO avanza_hrms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO avanza_hrms_app;
