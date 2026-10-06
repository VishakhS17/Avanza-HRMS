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
- PostgreSQL 18 binaries for `npm run db:up`

Sign-in and every signed-in page need the database. The login page can render before Postgres is up, but a sign-in attempt will fail until `npm run db:up` and `npm run db:migrate` have been run.

## Local setup

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

On Windows PowerShell, copy the env file with `Copy-Item .env.example .env`.

Set `AUTH_SECRET` (for example `npx auth secret`) and `AUTH_DEV_PASSWORD` in `.env` before signing in locally. `npm run db:seed` creates the bootstrap Super Admin from `AUTH_BOOTSTRAP_ADMIN_EMAIL` when that user does not exist yet. Running the seed again does not change an existing user's roles.

Open [http://localhost:3000](http://localhost:3000). You are sent to `/login` until you sign in.

`npm install` runs `prisma generate`.

`npm run db:up` starts a project-local Postgres on `127.0.0.1:5433` and creates the `avanza_app` role and `avanza_hrms` database. Data lives in `.data/`, which is gitignored. The first start can take a few minutes. `npm run db:down` stops it. This cluster is separate from any Postgres already using port 5432. If `initdb` is not on the default PostgreSQL 18 path, set `POSTGRES_BIN` to that `bin` directory before `npm run db:up`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string. The role must not be a superuser, because superusers ignore `GRANT` and `REVOKE`. `npm run db:up` creates `avanza_app` for this. |
| `AUTH_SECRET` | Yes | Auth.js secret. Generate one with `npx auth secret`. |
| `AUTH_URL` | No | Public app URL. Defaults to `http://localhost:3000`. Use `https://` in production so the session cookie is marked Secure. |
| `AUTH_ALLOWED_EMAIL_DOMAIN` | Yes | Company email domain. Sign-in is rejected unless the address is exactly `@this value` (subdomains do not match). If this is unset, sign-in fails closed. |
| `AUTH_BOOTSTRAP_ADMIN_EMAIL` | For the first admin | Created by `npm run db:seed` as Super Admin when that email does not exist. Must use the company domain. |
| `AUTH_BOOTSTRAP_ADMIN_NAME` | No | Display name for the bootstrap admin. Defaults to `Super Admin`. |
| `AUTH_GOOGLE_ID` | No | Google OAuth client id. Leave blank to hide the Google button. Callback: `{AUTH_URL}/api/auth/callback/google`. |
| `AUTH_GOOGLE_SECRET` | With Google | Google OAuth client secret. |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | No | Entra application (client) id. Leave blank to hide the Microsoft button. Callback: `{AUTH_URL}/api/auth/callback/microsoft-entra-id`. |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | With Microsoft | Entra client secret. |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | With Microsoft | Tenant issuer, for example `https://login.microsoftonline.com/{tenant-id}/v2.0`. Set this so personal Microsoft accounts cannot sign in. |
| `AUTH_DEV_LOGIN` | No | `true` shows the development password form. Ignored when `NODE_ENV` is `production`. |
| `AUTH_DEV_PASSWORD` | For dev login | Shared password that signs in an existing active user. It does not create accounts. Ignored in production. |
| `AUTH_IDLE_TIMEOUT_MINUTES` | No | Idle timeout for non-admin roles. Default 480 (8 hours). Checked on each request. |
| `AUTH_ADMIN_IDLE_TIMEOUT_MINUTES` | No | Idle timeout for Super Admin and HR Admin. Default 15. Checked on each request. |
| `EMPLOYEE_DATA_KEY` | For bank and ID fields | 32-byte key, base64-encoded. Encrypts bank details and government ID numbers. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |
| `POSTGRES_BIN` | No | Optional path to the PostgreSQL `bin` directory used by `npm run db:up`. |

Copy `.env.example` to `.env`. Do not commit `.env`.

## Development sign-in

The password form is for local development only. It is disabled when `NODE_ENV` is `production`, when `AUTH_DEV_LOGIN` is not `true`, or when `AUTH_DEV_PASSWORD` is empty. It signs in a user that already exists and is active. It does not create a user.

There is no self-signup. Google, Microsoft, and the dev form all reject the sign-in unless a matching `ACTIVE` user already exists on the company domain. The Auth.js adapter refuses to create a user during sign-in.

## SSO and MFA

MFA is enforced at the identity provider, not in this app. Turn it on for the groups that hold Super Admin and HR Admin before those people use SSO.

Google Workspace:

1. Create an OAuth client and set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.
2. In the Admin console, turn on 2-Step Verification and enforce it for the organizational unit that contains Super Admin and HR Admin accounts.
3. Restrict the OAuth client to the company domain. The app also sends the `hd` hint and rejects any email outside `AUTH_ALLOWED_EMAIL_DOMAIN`.

Microsoft Entra ID:

1. Register an app, add the callback URL above, and set `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, and `AUTH_MICROSOFT_ENTRA_ID_ISSUER` to that tenant.
2. Create a Conditional Access policy that requires MFA for the groups assigned Super Admin and HR Admin.
3. Leave personal Microsoft accounts out of that tenant. The issuer check is what keeps them out.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production server |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:up` | Start the local Postgres cluster and ensure `avanza_app` exists |
| `npm run db:down` | Stop the local Postgres cluster |
| `npm run db:migrate` | Create and apply a dev migration |
| `npm run db:seed` | Create the bootstrap Super Admin if that email is missing |
| `npm run db:studio` | Open Prisma Studio |
| `npm test` | Run permission, sign-in, session, user-admin, audit log, and employee scoping tests |

There are no scheduled jobs. Idle timeout and user status are checked on each request. System jobs can pass `actor: null` when they write an audit row.

## Project structure

```text
src/proxy.ts            Route protection (Next.js proxy). Public: /login and /api/auth
src/app/login/          Sign-in page and the dev-only password form
src/app/api/auth/       Auth.js route handler
src/app/(app)/          Signed-in routes and the app-shell layout
src/app/(app)/people/      HR employee list, create, and detail
src/app/(app)/directory/   Company directory
src/app/(app)/my-team/     Direct reports
src/app/(app)/settings/users/   Super Admin user and role management
src/app/(app)/settings/organization/  Departments, designations, locations
src/app/(app)/settings/audit-log/  Audit log viewer and CSV export
src/app/api/employees/[id]/  Employee JSON. Same scope as the pages.
src/components/layout/  Sidebar, top bar, shell
src/components/shared/  PageHeader, DataTable, StatusBadge, EmptyState, ConfirmDialog, FormField
src/components/ui/      shadcn/ui primitives
src/lib/auth.ts         Auth.js config
src/lib/permissions.ts  Permission map and can()
src/lib/services/       Business logic, including audit, sessions, and users
prisma/schema.prisma    User, Account, Session, AuditLog, Employee, Employment, and organization masters
prisma/seed.ts          Bootstrap Super Admin
prisma/migrations/      SQL migrations, including the append-only grants
prisma7.config.ts       Prisma 7 config
scripts/dev-postgres.mjs  Local Postgres start/stop
docs/PROGRESS.md        Build checklist
```

Colors live in `src/app/globals.css` as Tailwind theme tokens. Components use those tokens (`bg-primary`, `text-secondary`, and so on).

## Roles and permissions

Every user is an Employee. Roles are stored on the user and always include `EMPLOYEE`. `MANAGER` is also added when the current job row has direct reports who are active or on notice. A Super Admin can still assign `MANAGER` explicitly.

`can(user, action, resource)` in `src/lib/permissions.ts` is the only permission map. Server pages, server actions, route handlers, the proxy, and the sidebar all use it. Managers are limited to themselves and their direct reports for `employee.view` and `reports.view`. HR Admin and Super Admin are not limited to a team.

| Action | Who |
| --- | --- |
| Home, Inbox, My Space, Directory | Every active user |
| My Team | Manager, HR Admin, Super Admin |
| People | HR Admin, Super Admin |
| Reports | Manager (direct reports), HR Admin, Super Admin |
| Settings | HR Admin, Super Admin |
| Settings → Organization | HR Admin, Super Admin |
| Settings → Audit log | HR Admin, Super Admin |
| Settings → Users and roles | Super Admin |
| Reveal bank details and ID numbers | HR Admin |

A role that fails a page check is redirected to `/forbidden`. `/settings/audit-log/export` and `/api/*` return JSON `403`.

Sessions are stored in the database. Each request loads the user and rejects the session when the user is inactive, the session is expired, or it has been idle too long. Deactivation deletes that user's sessions in the same transaction, so the next request is signed out. An active session also ends after 7 days. Admin roles idle out after 15 minutes by default. Other roles idle out after 8 hours. Both are env-configurable and are not a cron job.

A Super Admin cannot change their own roles or status. The last active Super Admin cannot be demoted, deactivated, or marked exited. Users and employees are not hard-deleted. An exited employee is signed out.

HR Admin and Super Admin can create an employee. That also creates the matching user with the Employee role, using the work email as the sign-in address. The employee can edit their own phone, address, and emergency contact. Job fields, name, and work email stay with HR. A manager can open only their own record and current direct reports, including by URL and `GET /api/employees/{id}`. Bank details, PAN, and government ID numbers are encrypted with `EMPLOYEE_DATA_KEY`, masked on screen, and revealed only by HR Admin. A reveal writes an audit row and does not store the value.

No one will approve their own requests. Approval flows are a later step.

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

Passwords, tokens, bank details, and government ID numbers are replaced with `[REDACTED]` before the row is stored. Action names live in `AUDIT_ACTIONS`. Auth writes `AUTH_LOGIN`, `AUTH_LOGOUT`, and `AUTH_LOGIN_FAILED`. User admin writes `USER_CREATED`, `USER_ROLE_CHANGED`, `USER_DEACTIVATED`, and `USER_REACTIVATED`. Employee changes write `EMPLOYEE_CREATED`, `EMPLOYEE_UPDATED`, `EMPLOYEE_STATUS_CHANGED`, and `SENSITIVE_FIELD_REVEALED`. Organization masters write `SETTINGS_UPDATED`. There is no update or delete helper. The migration revokes `UPDATE`, `DELETE`, and `TRUNCATE` from the app role, and a trigger rejects update and delete statements.

The viewer is at [http://localhost:3000/settings/audit-log](http://localhost:3000/settings/audit-log). Filter by date (IST calendar days), actor, action, and entity. Results are paged at 25 rows. CSV export downloads the current filter, up to 5,000 rows. HR Admin and Super Admin can open it. Other roles cannot, including by calling the export URL directly.

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
