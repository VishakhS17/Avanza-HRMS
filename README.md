# Avanza HRMS

Internal HR system for Avanza Logistics. Web-first and usable on mobile browsers. One developer, so the app stays small and direct.

## Stack

- Next.js (App Router) and TypeScript
- Tailwind CSS and shadcn/ui
- PostgreSQL and Prisma
- Auth.js (database sessions, Google and Microsoft Entra SSO)

## Prerequisites

- Node.js 20.9 or newer
- npm
- A Neon database. This app uses the Avanza HRMS project.

Sign-in and every signed-in page need the database. The login page can render before the database is reachable, but a sign-in attempt fails until `DATABASE_URL` is set and `npm run db:migrate` has been run.

## Local setup

```bash
npm install
cp .env.example .env    # set DIRECT_URL to the owner role (see Database roles)
npm run db:migrate      # runs as the owner. Creates avanza_hrms_app and its grants
npm run db:roles        # turns on login for avanza_hrms_app and prints DATABASE_URL
                        # paste that DATABASE_URL into .env
npm run db:seed
npm run dev
```

On Windows PowerShell, copy the env file with `Copy-Item .env.example .env`.

Set `AUTH_SECRET` (for example `npx auth secret`) and `AUTH_DEV_PASSWORD` in `.env` before signing in locally. `npm run db:seed` creates the bootstrap Super Admin from `AUTH_BOOTSTRAP_ADMIN_EMAIL` when that user does not exist yet. Running the seed again does not change an existing user's roles.

Open [http://localhost:3000](http://localhost:3000). You are sent to `/login` until you sign in.

`npm install` runs `prisma generate`.

The app, the jobs, and the seed read `DATABASE_URL`, which connects as the restricted role `avanza_hrms_app` over the Neon pooler. Prisma migrate reads `DIRECT_URL`, which connects as the owner role `avanza_hrms_owner` on the direct host (no `-pooler`). In local `.env` both point at the dev database. Do not commit `.env`.

`npm run db:up` starts an optional local Postgres cluster on `127.0.0.1:5433`. The app uses Neon, not this cluster. Data for that cluster lives in `.data/`, which is gitignored. `npm run db:down` stops it. If `initdb` is not on the default PostgreSQL 18 path, set `POSTGRES_BIN` to that `bin` directory before `npm run db:up`.

## Databases

Three databases in the Neon project Avanza HRMS. Local development does not use the database Vercel uses. Before the pilot, production and the future demo each need their own Neon project. The production project must be on a paid plan: the Free plan keeps 6 hours of history, which is too short to restore from. The demo database is not built yet. The test database can stay on the `test` branch of the development project.

| Database | Neon branch | What it holds | Env file |
| --- | --- | --- | --- |
| `avanza_hrms_dev` | `dev` | Migrations, the bootstrap admin, and the optional hand-test sample data. Local app, seed, and `npm run db:migrate`. | `.env`: `DATABASE_URL` (app role, pooled host) and `DIRECT_URL` (owner role, direct host). `DEV_DATABASE_HOST` is that direct host. |
| `avanza_hrms_test` | `test` | Same migrations. `npm test` only. | `.env`: `TEST_DATABASE_URL` and `TEST_DIRECT_URL`. |
| `avanza_hrms` | `main` | The database the deployed app uses today, and the future production database. | Vercel environment variable `DATABASE_URL` (app role, pooled host). `.env.vercel` is a local scratch copy of that and is not loaded by Next.js. |

`npm run dev` and Prisma commands other than `prisma generate` refuse to start when `NODE_ENV` is not `production` and `DATABASE_URL` or `DIRECT_URL` uses `PRODUCTION_DATABASE_HOST`. `npm test` refuses both that host and `DEV_DATABASE_HOST`. A production process (`NODE_ENV=production`, including Vercel) may use the production host.

The `dev` and `test` branches also contain a database named `avanza_hrms`, copied when the branch was created. Do not point `.env` at it. The dev app uses `avanza_hrms_dev`, which was created empty and then migrated.

Set up the dev database once, the same way as the test database:

1. In Neon, create a branch named `dev` from `main`. On that branch, create the database `avanza_hrms_dev` owned by `avanza_hrms_owner`. Roles copy from the parent branch. Do not create or edit roles in the Console.
2. In `.env`, set `DIRECT_URL` to the owner on the dev branch's direct host and database `avanza_hrms_dev`. Set `DEV_DATABASE_HOST` to that direct host, and `PRODUCTION_DATABASE_HOST` to the host the deployed app uses.
3. Run `npm run db:migrate`, then `npm run db:roles -- --rotate`. Put the printed URL in `.env` as `DATABASE_URL`. This sets the app role's password on the dev branch only. Do not put that URL on Vercel.

## Database roles

Two roles, one per job:

| Role | Env var | Used by | Can do |
| --- | --- | --- | --- |
| `avanza_hrms_owner` | `DIRECT_URL` | `npm run db:migrate`, `npm run db:roles` | Owns every table. Runs DDL. |
| `avanza_hrms_app` | `DATABASE_URL` (`TEST_DATABASE_URL` for tests) | The Next.js app, jobs, seed, `npm test` | Read and write normal tables. `SELECT` and `INSERT` only on `audit_log`. No `TRUNCATE` anywhere. No access to `_prisma_migrations`. |

The app must never use the owner. On Neon the owner is in `neon_superuser`, which inherits `pg_write_all_data`. That role can `UPDATE` and `DELETE` every table, `audit_log` included, whatever the table grants say. The audit test fails unless `TEST_DATABASE_URL` connects as `avanza_hrms_app`.

Migration `20261006201500_audit_log_app_role` creates `avanza_hrms_app` without login and sets its grants. It also sets default privileges, so tables created by later migrations get read and write for the app role. A later append-only table must revoke `UPDATE` and `DELETE` from `avanza_hrms_app` in its own migration. Run migrations as `avanza_hrms_owner` so those default privileges apply.

`attendance_events` (raw punches) is append-only in the same way as `audit_log`. Migration `20261007120000_attendance_and_regularization` gives the app role only `SELECT` and `INSERT` on it and adds triggers that reject `UPDATE`, `DELETE`, and `TRUNCATE` for any role. A later migration that touches this table must keep both.

`document_versions` and `document_acknowledgements` are append-only too. Migration `20261007170000_documents` gives the app role only `SELECT` and `INSERT` on them, and only `SELECT` on `document_categories`, which the migration fills with the eight categories. A new file is a new version row, and a removed document keeps its versions.

`npm run db:roles` connects with `DIRECT_URL`. The first time, it turns on login and sets a random password for `avanza_hrms_app`. It then prints the `DATABASE_URL` to use, with the pooled host on Neon. It always checks that the app role is not elevated, is not a member of any role, owns nothing, and has exactly `SELECT` and `INSERT` on `audit_log`. If any check fails it exits with status 1. Running it again leaves the password alone. Run `npm run db:roles -- --rotate` to set a new one.

### On Neon

1. Use the database owner `avanza_hrms_owner` from the Console for `DIRECT_URL` (Connection details, pooling off).
2. For the database Vercel uses, run `npm run db:migrate` and `npm run db:roles` against that database's `DIRECT_URL`. Put the printed value in Vercel → Settings → Environment Variables as `DATABASE_URL`, then redeploy. The local `.env` `DATABASE_URL` stays on the dev branch.
3. Do not create or edit `avanza_hrms_app` in the Neon Console, CLI, or API. Neon adds roles created there to `neon_superuser`, and that defeats the restriction. Create and change it only with SQL, which is what the migration and `npm run db:roles` do.

To set the password by hand instead of with the script, run this in the Neon SQL Editor as `avanza_hrms_owner` after migrating:

```sql
ALTER ROLE avanza_hrms_app WITH LOGIN PASSWORD 'a-long-random-password';

-- Expect: no rows, then t t f f f
SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
WHERE m.member = 'avanza_hrms_app'::regrole;
SELECT has_table_privilege('avanza_hrms_app', 'audit_log', 'SELECT'),
       has_table_privilege('avanza_hrms_app', 'audit_log', 'INSERT'),
       has_table_privilege('avanza_hrms_app', 'audit_log', 'UPDATE'),
       has_table_privilege('avanza_hrms_app', 'audit_log', 'DELETE'),
       has_table_privilege('avanza_hrms_app', 'audit_log', 'TRUNCATE');
```

### Locally

`npm run db:up` creates the owner role `avanza_hrms_owner` (password `avanza_hrms_owner`, `NOSUPERUSER CREATEDB CREATEROLE`). It makes that role the owner of the `avanza_hrms` database and prints its `DIRECT_URL`. The older `avanza_app` role is not used. Its objects are reassigned to the owner. Then:

```bash
npm run db:up
# DIRECT_URL="postgresql://avanza_hrms_owner:avanza_hrms_owner@127.0.0.1:5433/avanza_hrms"
npm run db:migrate
npm run db:roles
# DATABASE_URL="postgresql://avanza_hrms_app:<printed>@127.0.0.1:5433/avanza_hrms"
```

## Test database

`npm test` never uses the dev database. It runs against the Neon branch `test` and its database `avanza_hrms_test`, which has the same two roles and the same migrations. The test runner swaps `DATABASE_URL` and `DIRECT_URL` for `TEST_DATABASE_URL` and `TEST_DIRECT_URL` in the test process.

The runner refuses to start when any of these is true:

- `NODE_ENV` is `production`.
- `PRODUCTION_DATABASE_HOST` is unset.
- `TEST_DATABASE_URL` or `TEST_DIRECT_URL` is missing.
- The test database name does not end in `_test`.
- A test URL uses the production host (`PRODUCTION_DATABASE_HOST`).
- `DEV_DATABASE_HOST` is unset, or a test URL uses that dev host.
- A test URL is the same host and database as `DATABASE_URL` or `DIRECT_URL`.
- `TEST_DATABASE_URL` does not connect as `avanza_hrms_app`.

Each database test file also checks that it is connected to a `_test` database.

Each test cleans up the rows it creates after it finishes, through `trackTestData()` in `src/test/fixtures.ts`. Audit rows stay because the app role cannot delete them. Test punches in `attendance_events` are removed through `TEST_DIRECT_URL` as the owner, with the table's triggers switched off only for that delete. Test document versions and acknowledgements are removed the same way, as the owner. The leave catalog and the document categories also stay, because they are shared reference data. Document tests store files in a temporary folder that is deleted afterwards. The runner fails if the test database has rows before the run, and fails if any test leaves rows behind, ignoring audit rows, the leave catalog, the document categories, and `_prisma_migrations`.

Set up a test database once:

1. In Neon, create a branch named `test` from `main`. On that branch, create the database `avanza_hrms_test` owned by `avanza_hrms_owner`. Roles copy from the parent branch.
2. In `.env`, set `TEST_DIRECT_URL` to the owner on the test branch's direct host and database. Set `PRODUCTION_DATABASE_HOST` to the host the deployed app uses, and `DEV_DATABASE_HOST` to the dev database's direct host.
3. Run `npm run db:test:migrate`, then `npm run db:test:roles -- --rotate`. Put the printed URL in `.env` as `TEST_DATABASE_URL`. This rotates the app role's password on the test branch only.

After adding a migration, run `npm run db:test:migrate` as well as `npm run db:migrate`.

`npm run db:migrate` (`prisma migrate dev`) currently fails while building its shadow database: the shadow copy cannot replay `20261006201500_audit_log_app_role`, which expects `_prisma_migrations` to exist. Do not edit that migration. To add a migration, generate the SQL from the dev database and apply it with `migrate deploy`:

```powershell
$name = "20261008090000_short_name"   # UTC timestamp, later than every existing folder
New-Item -ItemType Directory "prisma/migrations/$name"
node scripts/assert-dev-database.mjs npx prisma migrate diff --from-config-datasource `
  --to-schema prisma/schema.prisma --script --output "prisma/migrations/$name/migration.sql"
# Add any grants or seed rows to migration.sql, then:
node scripts/assert-dev-database.mjs npx prisma migrate deploy
npm run db:test:migrate
```

If a crashed run left rows behind, `npm run db:test:reset` empties the test tables, keeping audit rows and the leave catalog.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Pooled connection as `avanza_hrms_app`. Locally this is the dev database. Used by the app, jobs, and seed. Printed by `npm run db:roles`. Never the owner role. On Vercel this is the `main` branch database, not the dev database. |
| `DIRECT_URL` | For migrations | Direct connection (no `-pooler`) as the owner `avanza_hrms_owner`. Locally this is the dev database. Used only by Prisma migrate and `npm run db:roles`. Not needed on Vercel. Replaces `DATABASE_URL_UNPOOLED`. |
| `DEV_DATABASE_HOST` | For `npm test` | Direct host of the dev database. The test runner refuses to run against it. |
| `TEST_DATABASE_URL` | For `npm test` | Pooled connection as `avanza_hrms_app` to the test database (`avanza_hrms_test` on the Neon `test` branch). Printed by `npm run db:test:roles`. |
| `TEST_DIRECT_URL` | For `npm test` | Direct connection as the owner to the test database. Used by `db:test:*` commands, the leftover check, and test cleanup of rows the app role cannot delete. |
| `PRODUCTION_DATABASE_HOST` | For local dev and `npm test` | Direct host of the database the deployed app uses. `npm test` refuses it. So do `npm run dev` and migration commands when `NODE_ENV` is not `production`. |
| `AUTH_SECRET` | Yes | Auth.js secret. Generate one with `npx auth secret`. |
| `AUTH_URL` | No | Public app URL. Defaults to `http://localhost:3000`. Use `https://` in production so the session cookie is marked Secure. |
| `AUTH_ALLOWED_EMAIL_DOMAIN` | Yes | Company email domain. Sign-in is rejected unless the address is exactly `@this value` (subdomains do not match). If this is unset, sign-in fails closed. |
| `AUTH_BOOTSTRAP_ADMIN_EMAIL` | For the first admin | Created by `npm run db:seed` as Super Admin when that email does not exist. Must use the company domain. |
| `AUTH_BOOTSTRAP_ADMIN_NAME` | No | Display name for the bootstrap admin. Defaults to `Super Admin`. |
| `AUTH_GOOGLE_ID` | No | Google OAuth client id. Leave blank to hide the Google button. Callback: `{AUTH_URL}/api/auth/callback/google`. |
| `AUTH_GOOGLE_SECRET` | With Google | Google OAuth client secret. |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | No | Entra application (client) id. Leave blank to hide the Microsoft button. Callback: `{AUTH_URL}/api/auth/callback/microsoft-entra-id`. |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | With Microsoft | Entra client secret. |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | With Microsoft | One company tenant, for example `https://login.microsoftonline.com/{tenant-guid}/v2.0`. The Microsoft button stays hidden unless the value is that form. `common`, `organizations`, and `consumers` are rejected. |
| `AUTH_DEV_LOGIN` | No | Local only. `true` shows the shared password form when `NODE_ENV` is not `production` and `AUTH_DEV_PASSWORD` is set. Production ignores this variable. |
| `AUTH_DEV_PASSWORD` | For local password sign-in | Shared password that signs in an existing active user. It does not create accounts. Set it only in `.env`. Production ignores it. |
| `AUTH_IDLE_TIMEOUT_MINUTES` | No | Idle timeout for non-admin roles. Default 480 (8 hours). Checked on each request. |
| `AUTH_ADMIN_IDLE_TIMEOUT_MINUTES` | No | Idle timeout for Super Admin and HR Admin. Default 15. Checked on each request. |
| `EMPLOYEE_DATA_KEY` | For bank and ID fields | 32-byte key, base64-encoded. Encrypts bank details and government ID numbers. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |
| `STORAGE_DRIVER` | On Vercel | Where document files are kept. `local` is the dev disk and is refused in production. `s3` is any S3-compatible bucket. Unset means `local` outside production, and an upload error in production. |
| `STORAGE_LOCAL_DIR` | No | Local driver only. Folder for stored files. Default `.data/storage`, which is gitignored. |
| `STORAGE_SIGNING_SECRET` | With the local driver | At least 32 characters. Encrypts and signs the 60-second local download links. Generate one like `EMPLOYEE_DATA_KEY`. |
| `S3_BUCKET` | With `s3` | Private bucket name. Turn off public access on it. |
| `S3_REGION` | With `s3` | Bucket region, or `auto` for providers that use it. |
| `S3_ENDPOINT` | No | Blank for AWS. The provider's endpoint URL for R2, B2, MinIO, and similar. |
| `S3_ACCESS_KEY_ID` | With `s3` | Access key with put, get, and delete on that bucket only. |
| `S3_SECRET_ACCESS_KEY` | With `s3` | Secret for that key. |
| `S3_FORCE_PATH_STYLE` | No | `true` for providers that need path-style URLs, such as MinIO. Default `false`. |
| `BACKUP_DIR` | For `npm run db:backup` | Absolute directory outside this repository. The encrypted dump is written there. Not used by the app or by Vercel. |
| `BACKUP_ENCRYPTION_KEY` | For `npm run db:backup` | Passphrase of at least 16 characters. It is not written into the dump. Keep it with the other secrets, outside git. |
| `POSTGRES_BIN` | No | Optional path to the PostgreSQL `bin` directory used by `npm run db:up`. `pg_dump` and `pg_restore` must also be on `PATH` for backups. |

Copy `.env.example` to `.env`. Do not commit `.env`.

### Where each variable goes

| Place | Git | What belongs there |
| --- | --- | --- |
| `.env.example` | Tracked | Names, with secrets left empty. Copy this to `.env`. |
| `.env` | Local only | Secrets for this machine, including the dev database (`DATABASE_URL`, `DIRECT_URL`), the test database, `DEV_DATABASE_HOST`, `PRODUCTION_DATABASE_HOST`, `AUTH_SECRET`, `AUTH_DEV_PASSWORD`, OAuth secrets, `EMPLOYEE_DATA_KEY`, `STORAGE_SIGNING_SECRET`, `BACKUP_DIR`, and `BACKUP_ENCRYPTION_KEY`. |
| `.env.production` | Tracked | Non-secret production defaults only: `AUTH_DEV_LOGIN=false` and `AUTH_URL`. Next.js loads this file when `NODE_ENV` is `production`. |
| Vercel environment variables | Not in git | The deployed database, which is Neon branch `main`, database `avanza_hrms`: `DATABASE_URL` (pooled `avanza_hrms_app`), plus `AUTH_SECRET`, `AUTH_ALLOWED_EMAIL_DOMAIN`, OAuth client secrets, `EMPLOYEE_DATA_KEY`, `STORAGE_DRIVER=s3`, and the `S3_*` variables. Do not set the dev or test URLs, `AUTH_DEV_PASSWORD`, `AUTH_DEV_LOGIN`, or `DIRECT_URL`. Vercel values override `.env.production`. |

`.env.vercel` is a local scratch copy. It is gitignored, and Next.js does not load it.

## Development sign-in

The password form is shown only when `NODE_ENV` is not `production`, `AUTH_DEV_LOGIN` is `true`, and `AUTH_DEV_PASSWORD` is set. Production hides the form and rejects the sign-in action even if those variables are set in `.env.production` or on Vercel. It signs in a user that already exists and is active. It does not create a user.

There is no self-signup. Google, Microsoft, and the dev form all reject the sign-in unless a matching `ACTIVE` user already exists on the company domain. OAuth also requires `email_verified` to be true. A missing claim is treated as not verified. The dev password form does not use that claim. The Auth.js adapter refuses to create a user during sign-in.

Sign-in is limited in the database, so it still applies on Vercel. Five attempts per IP and five per email are allowed in a 15-minute window. The window starts at the first attempt and does not slide. A locked attempt returns the same message as a wrong password, and one `AUTH_LOGIN_LOCKED` audit row is written when the lockout starts. Later attempts in that window are refused with no further audit row. `/api/auth` allows 60 requests per IP in the same kind of window, so a normal OAuth redirect is not counted as a sign-in attempt. A blocked auth request returns `429` and `{ "error": "Sign-in was not accepted." }`.

## Hand-testing

`npm run seed:handtest` adds sample data to the dev database through the normal services, so each row has its usual audit entry. Run `npm run db:seed` first. The script acts as the bootstrap admin. Running it again creates nothing new and changes nothing that exists.

It refuses to run when `NODE_ENV` is `production`, when `PRODUCTION_DATABASE_HOST` is unset, when `DATABASE_URL` or `DIRECT_URL` uses the production host or the `TEST_DATABASE_URL` or `TEST_DIRECT_URL` host, when either names a database other than `avanza_hrms_dev`, or when `AUTH_ALLOWED_EMAIL_DOMAIN` is not a reserved example domain such as `avanza.example`.

It creates the department Hand-test Operations, the designation Hand-test Associate, and the location Hand-test Depot with its General shift (09:30–18:30, Saturday and Sunday off). It also creates three full-time employees who joined 30 days before the first run, each with an active user:

| Code | Sign-in email | Reports to | Approvals go to |
| --- | --- | --- | --- |
| `HT-MGR` | `handtest.manager@avanza.example` | Nobody | The bootstrap admin |
| `HT-A` | `handtest.employee.a@avanza.example` | `HT-MGR` | `HT-MGR` |
| `HT-B` | `handtest.employee.b@avanza.example` | Nobody | The bootstrap admin |

The bootstrap admin has no employee record, so nobody can report to that account. An employee with no manager has leave and regularization approvals routed to the earliest active HR Admin, then the earliest active Super Admin. On the dev database that is the bootstrap admin. `HT-MGR` gets the Manager role from having `HT-A` as a direct report.

To get past days to correct, run the attendance job for each of the last 5 days. The script does not create punches, so working days come out Absent:

```powershell
node scripts/assert-handtest-database.mjs   # same guard, check only. Stop if it refuses.
5..1 | ForEach-Object { npm run jobs:attendance-daily -- --date (Get-Date).AddDays(-$_).ToString("yyyy-MM-dd") }
```

This uses the machine's local date, which must be IST. Regularization accepts only the last 7 days, so run it again on a later day to get fresh dates.

To sign in as anyone, including the bootstrap admin (`AUTH_BOOTSTRAP_ADMIN_EMAIL`), open `/login` and use the Password form. Enter the user's email and the shared password from `AUTH_DEV_PASSWORD` in `.env`. The form appears when `AUTH_DEV_LOGIN` is `true` and `AUTH_DEV_PASSWORD` is set. Sign out from the top bar to switch users. Admin sessions idle out after 15 minutes.

## SSO and MFA

MFA is enforced at the identity provider, not in this app. Turn it on for the groups that hold Super Admin and HR Admin before those people use SSO.

Google Workspace:

1. Create an OAuth client and set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.
2. In the Admin console, turn on 2-Step Verification and enforce it for the organizational unit that contains Super Admin and HR Admin accounts.
3. Restrict the OAuth client to the company domain. The app also sends the `hd` hint and rejects any email outside `AUTH_ALLOWED_EMAIL_DOMAIN`.

Microsoft Entra ID:

1. Register an app in the company tenant, add the callback URL above, and set `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, and `AUTH_MICROSOFT_ENTRA_ID_ISSUER` to `https://login.microsoftonline.com/{tenant-guid}/v2.0`. The Microsoft button is hidden if the issuer is missing, is not HTTPS, or is `common`, `organizations`, or `consumers`.
2. Configure the ID token so `email` and `email_verified` are present and `email_verified` is true. A missing `email_verified` is treated as not verified, and sign-in is refused.
3. Create a Conditional Access policy that requires MFA for the groups assigned Super Admin and HR Admin.
4. Leave personal Microsoft accounts out of that tenant. The issuer check is what keeps them out. Linking still only attaches the provider to a user HR already created.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server. Refuses the production database host unless `NODE_ENV` is `production`. |
| `npm run build` | Production build |
| `npm run start` | Run the production server |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:up` | Start the local Postgres cluster and ensure the owner role `avanza_hrms_owner` exists |
| `npm run db:down` | Stop the local Postgres cluster |
| `npm run db:migrate` | Create and apply a migration on the dev database (as the owner, via `DIRECT_URL`). Refuses the production host unless `NODE_ENV` is `production`. Currently fails on its shadow database. Use the `migrate diff` steps under Test database. |
| `npm run db:roles` | Turn on login for `avanza_hrms_app`, print its `DATABASE_URL`, and check its `audit_log` privileges. `-- --rotate` sets a new password. |
| `npm run db:seed` | Create the bootstrap Super Admin if that email is missing, and insert leave types if they are missing |
| `npm run seed:handtest` | Dev database only. Add the hand-test department, location, and three sample users through the services (see Hand-testing). Running it again changes nothing. |
| `npm run db:studio` | Open Prisma Studio |
| `npm run jobs:leave-accrual` | Credit monthly and annual leave for the current Asia/Kolkata month or year. Running it again does not double-credit. One employee's failure is logged and the rest continue. The process exits 1 if any employee failed. |
| `npm run jobs:leave-carry-forward` | Forfeit leave above each type's carry cap for a completed calendar year. In January it uses the previous year. In other months pass `--year YYYY`. Running it again does not forfeit twice. A failure for one employee does not stop the others. The process exits 1 if any employee failed. |
| `npm run jobs:attendance-daily` | Compute daily attendance records from punches, leave, holidays, and the weekly off. It catches up from the latest stored day up to yesterday (IST). `-- --date YYYY-MM-DD` recomputes one past day. Running it again changes nothing. A failure for one employee does not stop the others. The process exits 1 if any employee failed. |
| `npm run db:backup` | Encrypted logical dump via `pg_dump` and `DIRECT_URL`. See Backups and restore. Not a Vercel cron. |
| `npm test` | Run every `src/**/*.test.ts` file one at a time against the test database (see Test database), then check that no test rows remain |
| `npm run db:test:migrate` | Apply migrations to the test database as its owner |
| `npm run db:test:roles` | `db:roles` for the test database. Use `-- --rotate` to print a fresh `TEST_DATABASE_URL`. |
| `npm run db:test:reset` | Empty the test database's tables, keeping audit rows and the leave catalog |

Idle timeout, the 7-day session cap, and user status are checked on each request, not by a job. The two leave commands and the attendance command are the scheduled jobs. Run them from cron or Task Scheduler on a machine that can reach the database. They are not started by `npm run dev`. Each employee is handled on its own. A thrown error is logged with that employee id, the run continues, and the process prints a summary and exits 1 if anything failed. A unique-key conflict on a rerun is not a failure. Schedule a retry when the exit code is 1.

Run `npm run jobs:attendance-daily` every night after 00:30 IST. A day is computed only once every shift that started on it can no longer be checked out of (shift end plus 6 hours). Until then that employee's day is counted as deferred, and the next run picks it up. With night shifts, run it later in the morning, or run it twice. A missed night is caught up on the next run. The job skips days that were regularized or overridden, and it skips locked months. System jobs pass `actor: null` on the audit row. Mail is printed to the server console. There is no SMTP variable.

## Project structure

```text
src/proxy.ts            Route protection, security headers, and 401 JSON for unsigned /api/*. Public: /login and /api/auth
src/app/login/          Sign-in page and the dev-only password form
src/app/api/auth/       Auth.js route handler
src/app/(app)/          Signed-in routes and the app-shell layout, including Home
src/app/(app)/reports/     Role-scoped reports and CSV export
src/app/(app)/people/      HR employee list, create, and detail
src/app/(app)/directory/   Company directory
src/app/(app)/my-team/     Direct reports and the team leave calendar
src/app/(app)/inbox/       Pending approvals and notifications
src/app/(app)/my-space/leave/  Balances, apply, and history
src/app/(app)/leave/       HR leave requests, adjustments, and reversals
src/app/(app)/settings/users/   Super Admin user and role management
src/app/(app)/settings/organization/  Departments, designations, locations
src/app/(app)/settings/holidays/  Holiday calendars and weekly off
src/app/(app)/settings/audit-log/  Audit log viewer and CSV export
src/app/(app)/settings/shifts/  One shift per location
src/app/(app)/my-space/attendance/  Check in and out, month calendar, regularization
src/app/(app)/my-team/attendance/   Direct reports' attendance
src/app/(app)/attendance/  HR daily view, employee months, and overrides
src/app/api/employees/[id]/  Employee JSON. Same scope as the pages.
src/app/(app)/my-space/documents/  Mine and From HR shelves, uploads, acknowledgements
src/app/(app)/documents/   HR document list, upload, and detail (versions, assignees, acks)
src/app/api/documents/[id]/file/  Checks access, then redirects to a 60-second signed link
src/app/api/storage/local/  Serves local-disk files from a signed token (dev only)
src/lib/storage/        Storage interface, local and S3 adapters, file validation
src/components/dashboard/  Home widget frame
src/components/attendance/  Punch card, calendar, month and date navigation
src/components/documents/  Shared document form helpers
scripts/leave-accrual.ts  Monthly and annual accrual job
scripts/leave-carry-forward.ts  Year-end carry-forward job
scripts/attendance-daily.ts  Nightly attendance job
scripts/backup-database.mjs  Encrypted pg_dump (npm run db:backup)
src/lib/security-headers.ts  CSP and the other response headers
src/components/layout/  Sidebar, top bar, shell
src/components/shared/  PageHeader, DataTable, StatusBadge, EmptyState, ConfirmDialog, FormField
src/components/ui/      shadcn/ui primitives
src/lib/auth.ts         Auth.js config
src/lib/permissions.ts  Permission map and can()
src/lib/services/       Business logic, including audit, sessions, users, dashboards, and reports
prisma/schema.prisma    Users, employees, leave, holidays, approvals, attendance, and documents
prisma/seed.ts          Bootstrap Super Admin and leave types
scripts/seed-handtest.ts  Dev-only hand-test sample data (npm run seed:handtest)
scripts/handtest-guard.mjs  Refuses hand-test seeding outside avanza_hrms_dev
prisma/migrations/      SQL migrations, including the append-only grants
prisma7.config.ts       Prisma 7 config
scripts/dev-postgres.mjs  Local Postgres start/stop
scripts/db-host-guard.mjs  Refuses the production host when NODE_ENV is not production
scripts/assert-dev-database.mjs  Runs dev and db:migrate only after that check
scripts/db-roles.mjs    App role login, password, and privilege check
scripts/run-tests.mjs   npm test: guard, test run, leftover check
scripts/test-db-guard.mjs  Refuses the dev host, the production host, and any database not ending in _test
src/test/fixtures.ts    Per-test cleanup (trackTestData)
docs/PROGRESS.md        Build checklist
```

Colors live in `src/app/globals.css` as Tailwind theme tokens. Components use those tokens (`bg-primary`, `text-secondary`, and so on).

## Roles and permissions

Every user is an Employee. Roles are stored on the user and always include `EMPLOYEE`. `MANAGER` is also added when the current job row has direct reports who are active or on notice. A Super Admin can still assign `MANAGER` explicitly.

`can(user, action, resource)` in `src/lib/permissions.ts` is the only permission map. Server pages, server actions, route handlers, the proxy, and the sidebar all use it. Managers are limited to themselves and their direct reports for `employee.view` and `reports.view`. HR Admin and Super Admin are not limited to a team.

| Action | Who |
| --- | --- |
| Home, Inbox, My Space, Directory | Every active user. Home widgets match the role: employees see their own actions, managers also see their team, HR Admin and Super Admin also see company figures. |
| My Team | Manager, HR Admin, Super Admin |
| People | HR Admin, Super Admin |
| Reports | Manager (direct reports only), HR Admin, Super Admin (everyone) |
| Settings | HR Admin, Super Admin |
| Settings → Organization | HR Admin, Super Admin |
| Settings → Audit log | HR Admin, Super Admin |
| Settings → Users and roles | Super Admin |
| Settings → Holiday calendar | HR Admin, Super Admin |
| Leave requests, balance adjustments, and reversals | HR Admin, Super Admin |
| Team leave calendar | Manager, HR Admin, Super Admin (direct reports) |
| Team attendance (`/my-team/attendance`) | Manager, HR Admin, Super Admin (direct reports) |
| Attendance daily view and overrides (`/attendance`), Settings → Shifts, and changes in a locked month (`attendance.manage`) | HR Admin, Super Admin |
| Reveal bank details and ID numbers | HR Admin |
| My Space → Documents (own files and files shared by HR) | Every active user |
| Documents (`/documents`): upload, assign, versions, acknowledgements, remove (`documents.manage`) | HR Admin, never on their own record except Policies |

A role that fails a page check is redirected to `/forbidden`. A signed-in caller who fails `/settings/audit-log/export`, `/reports/export`, or `/api/*` gets JSON `403`. A request to `/api/*` with no session gets JSON `401` and `{ "error": "Unauthorized" }`, not the login page. `/login` and `/api/auth` stay public.

Sessions are stored in the database. Each request loads the user and rejects the session when the user is inactive, the session is past its expiry, the session is past 7 days from sign-in, or it has been idle too long. Activity updates `lastActiveAt` only. It does not move `expires` or the sign-in time, so using the app cannot stretch a session past 7 days. Deactivation deletes that user's sessions in the same transaction, so the next request is signed out. Admin roles idle out after 15 minutes by default. Other roles idle out after 8 hours. Both idle values are env-configurable. The 7-day cap is not. None of this is a cron job.

A Super Admin cannot change their own roles or status. The last active Super Admin cannot be demoted, deactivated, or marked exited. Users and employees are not hard-deleted. An exited employee is signed out.

HR Admin and Super Admin can create an employee. That also creates the matching user with the Employee role, using the work email as the sign-in address. The employee can edit their own phone, address, and emergency contact. Job fields, name, and work email stay with HR. A manager can open only their own record and current direct reports, including by URL and `GET /api/employees/{id}`. Bank details, PAN, and government ID numbers are encrypted with `EMPLOYEE_DATA_KEY`, masked on screen, and revealed only by HR Admin. A reveal writes an audit row and does not store the value.

Leave balance is the sum of ledger rows, not a stored number. Applying places a hold. Approval releases the hold and posts a deduction. The employee can cancel a pending request before the start date. After the start date, or after approval, cancellation needs an approver. The approver is the current reporting manager when that person is active. Otherwise it is the earliest active HR Admin, then the earliest active Super Admin. Nobody can approve their own request. A manager can decide only when they are the assigned approver and still manage that person. HR can decide a request assigned to them, and can decide when the assigned manager is inactive or no longer the manager. Rejection needs a comment.

Casual leave accrues 1 day a month and does not carry forward. Sick leave accrues 6 days a year. Earned leave accrues 1.5 days a month and carries forward up to 12 days. Unpaid leave does not track a balance. Casual and Earned are not available during the first 6 months. Re-running the seed does not change an existing policy.

## Attendance

Employees check in and out on Home or My Space → Attendance. The server records the time and IP address. The time cannot be backdated. Punches are serialized per employee. Each location has one shift, which can be edited under Settings → Shifts. New locations get a General shift (09:30–18:30, 15 minutes grace, half day at 4 hours, full day at 8). A night shift's work date is the day the shift starts. A check-in can open up to `earlyCheckInMinutes` before the shift starts (default 240). A check-out is accepted until 6 hours after the shift ends. An open check-in older than that does not block a new one.

The nightly job turns each day into one record. A holiday comes first, then the weekly off, then full-day approved leave, then punches. Full-day hours give Present or WFH, half-day hours give Half day, and less than that gives Absent. Records are flagged Late, Early exit, or Incomplete. Approving, cancelling, or rejecting leave recomputes the affected days. So does adding a holiday or turning one on or off. Regularized, overridden, and locked days are not recomputed.

An employee can request a regularization for one of the last 7 days. The request gives in and out times and a reason, and goes to the same approver as leave through the Inbox. Only one request per day can be pending. Approval sets that day's record from the requested times. The raw punches stay as they were. A month locks after the 3rd of the following month. After that, only HR Admin and Super Admin can submit or approve a regularization for it. HR can override any record with a reason, including in a locked month, but not their own. Shift and weekly-off changes apply to days computed after the change and do not rewrite old records.

## Documents

Employees use My Space → Documents. It has two shelves. **Mine** holds files they uploaded or that HR uploaded on their behalf. **From HR** holds files HR shared with them, and shows a badge with the number waiting for acknowledgement. HR Admin uses **Documents** (`/documents`) to upload, assign, track acknowledgements, and see version history. From an employee's People page, the Documents button opens that person's files.

| Category | Uploaded by | Default visibility | Views audited |
| --- | --- | --- | --- |
| Identity, Address, Education, Certificates | The employee, or HR Admin on their behalf | Employee and HR | Yes |
| Employment, Payslips | HR Admin, for one employee | Employee and HR | Yes |
| Policies | HR Admin, for one or many employees | Employee and HR | No. Acknowledgements are audited. |
| Other HR | HR Admin, for one or many employees | HR only | Yes |

- Visibility is set per category. HR Admin can override it per document (Employee only, HR only, Employee and HR). Employees cannot change visibility, so they cannot hide their own uploads from HR.
- HR Admin can upload Identity, Address, Education, or Certificates for an employee who does not use a computer. A short "uploaded on behalf of" note is required. It is stored on the version and in the audit reason, and both screens show who uploaded the file.
- A new file is a new version. Employees see and download only the current version. HR sees every version. Each document can have an optional expiry date. There are no expiry alerts.
- "Requires acknowledgement" applies to HR categories. An acknowledgement records the user, the exact version, and the time. A new version makes the document pending again. The HR document page shows who has acknowledged and who is pending.
- **Assign to employees missing this** on a Policies or Other HR document adds every active employee who does not have it yet. Every active Policies document that requires acknowledgement is assigned automatically when an employee is created as Active or changes to Active.
- Notifications go to the Inbox: to the employee when a document is assigned to them or when a new version needs their acknowledgement, and to every HR Admin when an employee uploads a file or a new version.
- Removing a document is a soft delete with a reason. Employees can remove only files they uploaded themselves. Removed documents disappear for employees. HR still sees them, marked Removed, with their versions.
- Managers and Super Admins cannot see documents. Super Admin is not given `documents.manage`.

### HR Admin's own record

HR rights do not apply to an HR Admin's own record. On their own record an HR Admin is an employee like anyone else. They upload their own Identity, Address, Education, and Certificates from My Space, and cannot upload, change, assign, remove, or open HR-only files there. Every Employment, Payslips, and Other HR document for an HR Admin needs a second HR Admin. Policies are the exception, because they are company-wide.

### Files and downloads

- PDF, PNG, and JPEG only, up to 4 MB. The file's first bytes must match its extension and declared type. Uploads go through the server (Next.js server actions accept bodies up to 4.5 MB, matching Vercel's request limit).
- Storage is private. Files are stored under a random key (`documents/{uuid}`) that never appears in a page, a response, or the audit log.
- A download opens `/api/documents/{id}/file` (`?version=n` for HR). The server checks the session and the access rules, audits the view for audited categories, and redirects to a signed link that expires after 60 seconds. Guessed, missing, and forbidden IDs all get the same 404. An exited or deactivated employee cannot download.
- With the local driver, the link is `/api/storage/local?token=...`. The token is encrypted and authenticated with `STORAGE_SIGNING_SECRET`, so it cannot be edited to point at another file. That route returns 404 in production. With `s3`, the link is an S3 presigned URL for that one object.
- Files are always served as attachments, with the file name cleaned of paths, control characters, and quote and header characters.
- **Known limitation:** uploads are not scanned for malware. Revisit this before rolling documents out beyond HR's own use.

### Storage setup

Local development needs only `STORAGE_SIGNING_SECRET` in `.env` (files go to `.data/storage`). Vercel has no persistent disk, so the deployed app needs `STORAGE_DRIVER=s3` and the `S3_*` variables. The provider is not chosen yet. Any S3-compatible service works. Create a private bucket, turn on Block Public Access, and turn on default encryption (SSE-S3 or SSE-KMS). Every upload from this app also sets `ServerSideEncryption: AES256`. Give the access key put, get, and delete on that bucket only, set the variables on Vercel, and redeploy. Until then, uploads on Vercel fail with a configuration error, and the rest of the app works. A database dump does not include these files. Keep bucket versioning, or a separate copy, if a deleted object must be recoverable.

## Rules

- Permission checks run on the server.
- State changes call `audit.log` in the same database transaction as the change.
- Employee and user records are not hard-deleted. Use status.
- Business logic belongs in `src/lib/services`, not in components.

## Audit log

`audit.log` in `src/lib/services/audit.ts` inserts one row. Pass the transaction client as the second argument so the audit row commits or rolls back with the change:

```ts
await db.$transaction(async (tx) => {
  await audit.log(
    {
      actor: userId, // null for a system job
      action: AUDIT_ACTIONS.EMPLOYEE_UPDATED,
      entityType: "Employee",
      entityId,
      before,
      after,
      reason,
    },
    tx,
  );
});
```

Passwords, tokens, bank details, and government ID numbers are replaced with `[REDACTED]` before the row is stored. Action names live in `AUDIT_ACTIONS`. Auth writes `AUTH_LOGIN`, `AUTH_LOGOUT`, `AUTH_LOGIN_FAILED`, and `AUTH_LOGIN_LOCKED` (one row when a sign-in lockout starts, not one per blocked attempt). User admin writes `USER_CREATED`, `USER_ROLE_CHANGED`, `USER_DEACTIVATED`, and `USER_REACTIVATED`. Employee changes write `EMPLOYEE_CREATED`, `EMPLOYEE_UPDATED`, `EMPLOYEE_STATUS_CHANGED`, and `SENSITIVE_FIELD_REVEALED`. Organization masters write `SETTINGS_UPDATED`. Leave and holidays write `LEAVE_REQUESTED`, `LEAVE_APPROVED`, `LEAVE_REJECTED`, `LEAVE_CANCELLED`, `LEAVE_BALANCE_ADJUSTED`, `LEAVE_ACCRUED`, `LEAVE_CARRY_FORWARD`, `LEAVE_REVERSED`, `HOLIDAY_CREATED`, and `HOLIDAY_UPDATED`. Attendance writes `ATTENDANCE_CHECKED_IN`, `ATTENDANCE_CHECKED_OUT`, `ATTENDANCE_RECORDED` (only when a computed record changes), `ATTENDANCE_OVERRIDDEN`, `ATTENDANCE_REGULARIZATION_REQUESTED`, `ATTENDANCE_REGULARIZATION_APPROVED`, `ATTENDANCE_REGULARIZATION_REJECTED`, `SHIFT_CREATED`, and `SHIFT_UPDATED`. Documents write `DOCUMENT_UPLOADED`, `DOCUMENT_VERSION_ADDED`, `DOCUMENT_UPDATED` (details or visibility), `DOCUMENT_ASSIGNED`, `DOCUMENT_REMOVED`, `DOCUMENT_ACKNOWLEDGED`, and `DOCUMENT_VIEWED` (each download in every category except Policies). Report CSV downloads write `REPORT_EXPORTED`. There is no update or delete helper. The app role `avanza_hrms_app` has only `SELECT` and `INSERT` on `audit_log`. `UPDATE`, `DELETE`, and `TRUNCATE` are revoked from it and from `PUBLIC`. A trigger also rejects update and delete for any role, the owner included. See Database roles.

The client IP on an audit row comes from a header the platform sets. On Vercel that is the first address in `x-vercel-forwarded-for`. Elsewhere it is `x-real-ip`, and only when a trusted proxy in front of the app sets that header. `X-Forwarded-For` is ignored, because the browser can set it. If neither trusted header is present, the row stores no IP.

The viewer is at [http://localhost:3000/settings/audit-log](http://localhost:3000/settings/audit-log). Filter by date (IST calendar days), actor, action, and entity. Results are paged at 25 rows. CSV export downloads the current filter, up to 5,000 rows. HR Admin and Super Admin can open it. Other roles cannot, including by calling the export URL directly.

## Home and reports

Home is the signed-in landing page. The check-in card, leave balances, pending leave, next holidays, and document acknowledgements are on every Home. Each block links to My Space. Managers also see pending approvals, who is out today and this week, team attendance today, and missing punches, limited to current direct reports, with links to Inbox and My Team. HR Admin and Super Admin also see headcount, this month's joiners and exits, today's attendance summary, and pending HR actions, with links to People, Attendance, Leave, Documents, and Inbox.

Reports are at [http://localhost:3000/reports](http://localhost:3000/reports). Choose a report, filter, view the table, and export CSV. The four reports are headcount by department, location, or status; daily attendance; monthly attendance per employee; and leave balances. Managers see only their current direct reports in every report and in the CSV. HR Admin and Super Admin see everyone. Exporting writes `REPORT_EXPORTED` with the filters and row count. Employees cannot open `/reports` or `/reports/export`.

## Security headers

Every response from the proxy sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy` with camera, microphone, geolocation, payment, and USB disabled, and a Content-Security-Policy. The policy uses a per-request nonce for scripts (`strict-dynamic`) and, in production, for styles. `frame-ancestors 'none'` matches the frame denial. Production responses over HTTPS also send `upgrade-insecure-requests` and `Strict-Transport-Security` (`max-age=63072000; includeSubDomains`). Development adds `'unsafe-eval'` for scripts and `'unsafe-inline'` for styles so the dev server can run. The root layout calls `connection()` so pages render per request and Next.js can attach the nonce. Account menus and the mobile navigation still open under this policy. The browser console can report a blocked inline style from those components.

## Backups and restore

Neon history is not the backup. On the Free plan that history is 6 hours. The production project needs a paid plan with a longer window, and it still needs a logical dump stored outside Neon.

`npm run db:backup` runs `pg_dump` (custom format, no owner, no privileges) through `DIRECT_URL`, encrypts the file with AES-256-GCM, and writes it under `BACKUP_DIR`. The passphrase is `BACKUP_ENCRYPTION_KEY` (at least 16 characters). The key is not stored in the file. `BACKUP_DIR` must be an absolute path outside this repository. The plaintext dump is deleted after encryption. A dump of the host in `PRODUCTION_DATABASE_HOST` requires `--production`.

This does not run on Vercel. There is no `pg_dump` in a serverless function. Schedule it daily on a machine that has the PostgreSQL client tools, the production `DIRECT_URL`, and the backup passphrase. Example, once the production owner URL is in the environment for that job only:

```powershell
npm run db:backup -- --production
```

Decrypt when you are ready to restore. The output path must be absolute and outside the repository:

```powershell
node scripts/backup-database.mjs --decrypt D:\backups\avanza-hrms-avanza_hrms-20261011T023000Z.dump.enc --out D:\backups\restore.dump
```

The dump contains application-encrypted bank and ID values, and the other columns as stored, including address, phone, and date of birth. It does not contain the S3 document bytes.

### Restore test

Do this on a throwaway branch before any production restore, and again as a pre-pilot check.

1. In the production Neon project, create a branch from the current production branch. Name it so it is obvious it is disposable, for example `restore-test-20261011`.
2. Decrypt one daily dump to a path outside the repository.
3. Restore onto that branch's database with `pg_restore --no-owner --no-acl` using the branch's direct owner URL. Do not restore onto `main`, `dev`, or `test`.
4. Point a temporary `DATABASE_URL` (app role on that branch) at it and confirm a known employee, a leave balance, and a recent audit row match production.
5. Delete the throwaway branch and the decrypted dump when the check passes.

A real restore uses the same steps onto a new branch, then switches the Vercel `DATABASE_URL` to that branch's app-role URL after the check. Do not overwrite the live database in place.

## Production deployment

Deploy the app to Vercel. Apply schema changes from a machine that has `pg` client tools and the production owner URL, not from the Vercel build.

1. Use a Neon project that is not the development project and not the future demo project. Put it on a paid plan before the pilot.
2. Set `DIRECT_URL` in that shell to the production owner on the direct host. Run `npx prisma migrate deploy --config prisma7.config.ts`. Do not run `prisma migrate dev` or `prisma db push` against production.
3. Run `npm run db:roles` against that same `DIRECT_URL`. Put the printed pooled app-role URL in Vercel as `DATABASE_URL`. The running app must not use the owner role.
4. Set the other Vercel variables from the table above: `AUTH_SECRET`, `AUTH_URL` (`https://`), `AUTH_ALLOWED_EMAIL_DOMAIN`, the OAuth secrets, `EMPLOYEE_DATA_KEY`, `STORAGE_DRIVER=s3`, and the `S3_*` variables. Do not set `AUTH_DEV_LOGIN`, `AUTH_DEV_PASSWORD`, `DIRECT_URL`, `BACKUP_ENCRYPTION_KEY`, or the dev and test URLs.
5. Deploy. `.env.production` in git only sets `AUTH_DEV_LOGIN=false` and `AUTH_URL`. Vercel overrides those.

Rollback of an application change is a redeploy of the previous Vercel deployment. Do not edit a migration that has already been applied. If a migration is wrong, add a new migration that fixes it forward. If a migration destroyed data, restore the logical dump taken before that migration onto a new branch, check it, then point `DATABASE_URL` at that branch's app role and redeploy.

## Pre-pilot checklist

- Google or Microsoft SSO is configured for the company domain, and MFA is required for Super Admin and HR Admin at the identity provider.
- Mail goes through a real provider. The app currently prints messages to the server console.
- `STORAGE_DRIVER=s3`, the bucket has Block Public Access and default encryption, an upload and a download have been tested, and the access key cannot reach other buckets.
- `jobs:leave-accrual`, `jobs:leave-carry-forward`, and `jobs:attendance-daily` are scheduled, and a failed run is visible (the process exits 1).
- A daily `npm run db:backup` is scheduled outside Vercel, and a restore has been tested on a throwaway branch.
- Two active HR Admin accounts exist, so one HR Admin's own documents can be handled by the other.
- The production Neon project is on a paid plan with history longer than the Free plan's 6 hours, and it is a separate project from development and demo.

## Known limitations

- The audit log stores address, phone, and date of birth in clear text. Bank details, PAN, and government ID values are encrypted and are not copied into the audit row.
- Marking an inbox notification read changes state and is not written to the audit log.
- Uploads are not scanned for malware.
- Decision and submission emails print to the console. There is no SMTP setting.
- The demo database and its seed are a later step. They are not in this repository yet.

## Troubleshooting

- Sign-in says the database is not reachable: `DATABASE_URL` must be the app role, and `npm run db:migrate` (or `prisma migrate deploy` for an existing database) must have been applied.
- `npm run db:migrate` fails while building a shadow database: do not edit the old migration. Generate the SQL with `prisma migrate diff` and apply it with `prisma migrate deploy`, as under Test database.
- `npm run dev` or a migration command exits immediately: `DATABASE_URL` or `DIRECT_URL` is using `PRODUCTION_DATABASE_HOST`. Point them at the dev database.
- The password form is missing: `NODE_ENV` is `production`, or `AUTH_DEV_LOGIN` / `AUTH_DEV_PASSWORD` is unset. Production never shows that form.
- SSO returns to the login page with no new user: the address must already be an active user on `AUTH_ALLOWED_EMAIL_DOMAIN`, the provider must send `email_verified: true`, and the Microsoft issuer must be the company tenant GUID.
- Repeated sign-in failures all look the same: that is the lockout. Wait 15 minutes from the first attempt in the window. There is one `AUTH_LOGIN_LOCKED` row, not one per try.
- `npm run db:backup` cannot find `pg_dump`: install the PostgreSQL client tools and add their `bin` directory to `PATH`.
- A production page is blank or a script is blocked: the Content-Security-Policy nonce is enforced. Check the browser console before loosening the policy.

## Changelog

### 2026-10-05

- Scaffolded Next.js, TypeScript, Tailwind, shadcn/ui, Prisma, env handling, and a seed skeleton.
- Added Avanza theme tokens, the app shell, sidebar sections, and shared UI components.
- No roles, permissions, audit log, models, or scheduled jobs yet.

### 2026-10-05 — Audit log

- Added the append-only `AuditLog` model, `audit.log`, and redaction of passwords, tokens, bank details, and ID numbers.
- The migration revokes `UPDATE`, `DELETE`, and `TRUNCATE` on `audit_log` from the app role and rejects those statements with a trigger.
- Added the Settings audit log viewer with filters, paging, and CSV export.
- Added `npm run db:up`, `npm run db:down`, and `npm test`. Local Postgres uses the non-superuser role `avanza_app` on port 5433.
- No new scheduled jobs.

### 2026-10-06 — Authentication and roles

- Auth.js database sessions with Google and Microsoft Entra SSO, limited to `AUTH_ALLOWED_EMAIL_DOMAIN`. Sign-in requires an existing active user. There is no self-signup.
- Development password sign-in is off in production.
- `can()` in `src/lib/permissions.ts` gates pages, actions, the proxy, and the sidebar. Settings → Users and roles is Super Admin only. The audit log is HR Admin and Super Admin.
- Each request checks user status, expiry, and idle timeout. Admin idle is shorter. Deactivation drops sessions immediately.
- Login, logout, failed login, role changes, and deactivation or reactivation are written to the audit log.
- MFA for admin roles is configured at Google Workspace or Entra, documented above. No scheduled jobs were added.

### 2026-10-06 — Employees and organization

- Added employee records, effective-dated employment history, and department, designation, and location masters.
- HR can list, add, and edit employees. Creating an employee also creates their sign-in user. Employees edit their own contact and emergency details.
- The directory lists people who are active or on notice. Managers see only current direct reports.
- Bank details and government ID numbers are encrypted with `EMPLOYEE_DATA_KEY` and masked. HR Admin reveals are audited.
- No hard delete, and no new scheduled jobs.

### 2026-10-07 — Leave, holidays, and approvals

- Added leave types, a ledger-derived balance, leave requests, a per-location holiday calendar, and a shared approval inbox.
- Submitting leave places a hold. The reporting manager approves or rejects from the Inbox. HR can adjust or reverse a balance and can see every request.
- Accrual and year-end carry-forward are idempotent commands: `npm run jobs:leave-accrual` and `npm run jobs:leave-carry-forward`.
- Decision and submission emails print to the console. No new environment variables.

### 2026-10-07 — Neon database

- The running app uses the Neon project Avanza HRMS instead of the local cluster on port 5433.
- `DATABASE_URL` is the pooled connection. `DATABASE_URL_UNPOOLED` is the direct connection used by Prisma migrate and seed.
- Rows that were in the local database were copied to Neon.

### 2026-10-07 — Deployed password sign-in

- The shared password form was available on Vercel while `AUTH_DEV_LOGIN` was `true` and `AUTH_DEV_PASSWORD` was set in `.env.production`. That is reversed below.

### 2026-10-07 — Dev password sign-in stays off in production

- `isDevLoginEnabled` returns false when `NODE_ENV` is `production`, whatever `AUTH_DEV_LOGIN` and `AUTH_DEV_PASSWORD` say.
- `.env.production` keeps only `AUTH_DEV_LOGIN=false` and the public `AUTH_URL`. The shared password is not committed.

### 2026-10-07 — Restricted app database role

- Fixed the audit log privilege check. The app and tests had connected as the Neon owner, which inherits `pg_write_all_data` through `neon_superuser` and could `UPDATE` and `DELETE` `audit_log`.
- New migration `20261006201500_audit_log_app_role` creates `avanza_hrms_app` with `SELECT` and `INSERT` only on `audit_log`, read and write elsewhere, and matching default privileges. The original audit migration is unchanged.
- `DATABASE_URL` now connects as `avanza_hrms_app`. `DIRECT_URL` (owner, direct host) replaces `DATABASE_URL_UNPOOLED` and is used only by Prisma migrate and `npm run db:roles`.
- Added `npm run db:roles`. `npm run db:up` now creates the local owner role `avanza_hrms_owner` instead of `avanza_app`.
- `npm test` runs files one at a time, so one file's test HR Admin cannot become another file's approver. The audit test also checks `TRUNCATE`, and checks that it runs as `avanza_hrms_app`, which owns nothing and is not a member of the owner.
- On Vercel, set `DATABASE_URL` to the `avanza_hrms_app` URL and redeploy. No new scheduled jobs.

### 2026-10-07 — Separate test database

- `npm test` runs against the Neon branch `test` (database `avanza_hrms_test`) through `TEST_DATABASE_URL`, never the dev database. New env vars: `TEST_DATABASE_URL`, `TEST_DIRECT_URL`, `PRODUCTION_DATABASE_HOST`.
- The runner refuses production, the production host, and the dev database. It requires a `_test` database name. It fails if rows are left behind, ignoring audit rows and the leave catalog.
- Each test cleans up its own rows (`trackTestData()`). New commands: `db:test:migrate`, `db:test:roles`, `db:test:reset`.
- The leave approver test now creates its own Super Admin. It had relied on the bootstrap admin in the dev database.

### 2026-10-07 — Attendance and regularization

- Added shifts (one per location), web check-in and check-out, daily attendance records, and regularization requests through the shared Inbox.
- New scheduled job `npm run jobs:attendance-daily`. It catches up missed days and running it again changes nothing. Leave and holiday changes recompute the affected days.
- New permission `attendance.manage` (HR Admin, Super Admin) for `/attendance`, overrides, Settings → Shifts, and locked months. Managers see direct reports at `/my-team/attendance`.
- `attendance_events` is append-only, enforced by grants and triggers. Employees have a new `exitDate`, set when status changes to Exited and backfilled for existing exits.
- No new environment variables. The test guard now compares against the original dev URLs, so `db:test:reset` works again.

### 2026-10-07 — Separate dev database

- Local `.env` `DATABASE_URL` and `DIRECT_URL` point at the Neon branch `dev`, database `avanza_hrms_dev` (empty, then migrated). Vercel and `.env.vercel` stay on branch `main`, database `avanza_hrms`.
- New env var `DEV_DATABASE_HOST`. `npm test` refuses that host and `PRODUCTION_DATABASE_HOST`. `npm run dev` and migration commands refuse the production host when `NODE_ENV` is not `production`.

### 2026-10-07 — Hand-test seed

- New command `npm run seed:handtest`. It adds one department, designation, and location, plus three sample users on `avanza.example`, to the dev database through the services. Running it again changes nothing.
- It refuses production `NODE_ENV`, the production and test hosts, any database other than `avanza_hrms_dev`, and a non-example email domain.
- No auth change. The dev password form already signs in any active user on the company domain. No new environment variables or scheduled jobs.

### 2026-10-07 — Documents

- Added document categories, documents, assignments, append-only versions, and append-only acknowledgements (migration `20261007170000_documents`). Screens: My Space → Documents (Mine and From HR) and HR Documents at `/documents`.
- New permission `documents.manage` (HR Admin only). Managers and Super Admins cannot see documents. HR rights do not apply to an HR Admin's own record, except Policies, so those files need a second HR Admin.
- HR can upload employee-category files on an employee's behalf with a required note. Policies requiring acknowledgement are assigned automatically to new and newly active employees, and "assign to employees missing this" fills gaps. Assignments, new versions to acknowledge, and employee uploads create Inbox notifications.
- Private storage behind an S3-compatible interface, with a local-disk adapter for development. Downloads redirect to 60-second signed links. PDF, PNG, and JPEG up to 4 MB, checked by content. No malware scanning yet.
- New env vars: `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `STORAGE_SIGNING_SECRET`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`. Vercel needs `STORAGE_DRIVER=s3` and a bucket before uploads work there. No new commands or scheduled jobs.
- `npm run db:migrate` fails on its shadow database. New migrations are generated with `prisma migrate diff` and applied with `migrate deploy` (see Test database).

### 2026-10-07 — Dashboards and reports

- Home is role-aware. Employee widgets cover check-in, leave, holidays, and document acknowledgements. Managers also see their team. HR Admin and Super Admin also see company headcount, joiners and exits, today's attendance, and pending HR actions. Every widget links to the page that acts on it.
- `/reports` has headcount, daily attendance, monthly attendance, and leave balances, with filters and CSV export. Managers are limited to current direct reports. CSV export writes `REPORT_EXPORTED`.
- No new environment variables, commands, or scheduled jobs. No new tables.

### 2026-10-11 — Security review

- Sign-in and `/api/auth` are rate-limited in `auth_rate_limits` (per IP and per email on sign-in). A lockout writes one `AUTH_LOGIN_LOCKED` row. The limit is in the database so it holds on Vercel.
- Responses send HSTS (production), `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, a locked-down Permissions-Policy, and a nonce Content-Security-Policy.
- OAuth treats a missing `email_verified` as not verified. Microsoft is registered only when `AUTH_MICROSOFT_ENTRA_ID_ISSUER` is the company tenant.
- A session ends 7 days after sign-in. Activity cannot move that deadline. Idle timeouts are unchanged.
- Audit IPs use `x-vercel-forwarded-for` on Vercel, then `x-real-ip`. `X-Forwarded-For` is ignored.
- The leave and attendance jobs keep going after one employee fails, log that failure, and exit 1 if any failed. Reruns stay idempotent.
- S3 uploads set SSE-S3 (`AES256`). The bucket still needs default encryption and Block Public Access.
- Unsigned `/api/*` returns JSON 401. New command `npm run db:backup` writes an encrypted `pg_dump` outside Neon. New env vars: `BACKUP_DIR`, `BACKUP_ENCRYPTION_KEY`.
- Migration `20261010211500_auth_rate_limit_and_session_start` adds `sessions.createdAt` and `auth_rate_limits`.
