# Avanza HRMS

Internal HR system for Avanza Logistics. Web-first and usable on mobile browsers. One developer, so the app stays small and direct.

## Stack

- Next.js (App Router) and TypeScript
- Tailwind CSS and shadcn/ui
- PostgreSQL and Prisma
- Auth.js (reserved; not wired up yet)

## Prerequisites

- Node.js 20.9 or newer
- npm
- PostgreSQL 18 binaries for `npm run db:up`. The app shell still runs without a database.

## Local setup

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:migrate
npm run dev
```

On Windows PowerShell, copy the env file with `Copy-Item .env.example .env`.

Open [http://localhost:3000](http://localhost:3000).

`npm install` runs `prisma generate`. The app shell still opens without Postgres. The audit log, migrations, and later data features need the database.

`npm run db:up` starts a project-local Postgres on `127.0.0.1:5433` and creates the `avanza_app` role and `avanza_hrms` database. Data lives in `.data/`, which is gitignored. The first start can take a few minutes. `npm run db:down` stops it. This cluster is separate from any Postgres already using port 5432. If `initdb` is not on the default PostgreSQL 18 path, set `POSTGRES_BIN` to that `bin` directory before `npm run db:up`.

## Environment variables

| Variable | Required now | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | For the audit log and later data features | PostgreSQL connection string. The role must not be a superuser, because superusers ignore `GRANT` and `REVOKE`. `npm run db:up` creates `avanza_app` for this. |
| `AUTH_SECRET` | No | Reserved for Auth.js |
| `AUTH_URL` | No | Reserved for Auth.js. Defaults to `http://localhost:3000` in code when unset |
| `POSTGRES_BIN` | No | Optional path to the PostgreSQL `bin` directory used by `npm run db:up` |

Copy `.env.example` to `.env`. Do not commit `.env`.

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
| `npm run db:seed` | Run the seed script |
| `npm run db:studio` | Open Prisma Studio |
| `npm test` | Run the audit log tests |

The `AuditLog` model is the only model. There are no scheduled jobs. The seed script prints a message and inserts nothing. System jobs can pass `actor: null` when they write an audit row.

## Project structure

```text
src/app/(app)/          Routes and the app-shell layout
src/components/layout/  Sidebar, top bar, shell
src/components/shared/  PageHeader, DataTable, StatusBadge, EmptyState, ConfirmDialog, FormField
src/components/ui/      shadcn/ui primitives
src/lib/                env, database client, navigation
src/lib/services/       Business logic. `audit.ts` is the audit log
src/app/(app)/settings/audit-log/  Audit log viewer and CSV export
prisma/schema.prisma    Database schema
prisma/seed.ts          Seed skeleton
prisma/migrations/      SQL migrations, including the append-only grants
prisma7.config.ts       Prisma 7 config
scripts/dev-postgres.mjs  Local Postgres start/stop
docs/PROGRESS.md        Build checklist
```

Colors live in `src/app/globals.css` as Tailwind theme tokens. Components use those tokens (`bg-primary`, `text-secondary`, and so on).

## Roles

Roles are not enforced yet. The sidebar shows every section. `isNavItemVisible` in `src/lib/navigation.ts` is a stub that always returns true. Each item records an intended audience for a later step:

| Section | Intended roles (not enforced) |
| --- | --- |
| Home, Inbox, My Space, Directory | employee, manager, hr, admin |
| My Team, Reports | manager, hr, admin |
| People (HR) | hr, admin |
| Settings | admin |
| Settings → Audit log | admin (not enforced yet) |

Permission checks will be server-side. No one will approve their own requests.

The audit log page and its CSV export call `assertCanViewAuditLog()` in `src/lib/services/audit-access.ts`. That function is a temporary stub and allows access. Real role checks replace it in the next step.

## Rules

- Permission checks run on the server.
- State changes call `audit.log` in the same database transaction as the change.
- Employee data is not hard-deleted. Use status or a soft delete.
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

Passwords, tokens, bank details, and government ID numbers are replaced with `[REDACTED]` before the row is stored. Action names live in `AUDIT_ACTIONS`. There is no update or delete helper. The migration revokes `UPDATE`, `DELETE`, and `TRUNCATE` from the app role, and a trigger rejects update and delete statements.

The viewer is at [http://localhost:3000/settings/audit-log](http://localhost:3000/settings/audit-log). Filter by date (IST calendar days), actor, action, and entity. Results are paged at 25 rows. CSV export downloads the current filter, up to 5,000 rows.

## Changelog

### 2026-10-05

- Scaffolded Next.js, TypeScript, Tailwind, shadcn/ui, Prisma, env handling, and a seed skeleton.
- Added Avanza theme tokens, the app shell, sidebar sections, and shared UI components.
- Reserved `AUTH_SECRET` and `AUTH_URL` for Auth.js. Authentication is not implemented.
- No roles, permissions, audit log, models, or scheduled jobs yet.

### 2026-10-05 — Audit log

- Added the append-only `AuditLog` model, `audit.log`, and redaction of passwords, tokens, bank details, and ID numbers.
- The migration revokes `UPDATE`, `DELETE`, and `TRUNCATE` on `audit_log` from the app role and rejects those statements with a trigger.
- Added the Settings audit log viewer with filters, paging, and CSV export. Access is a stub until roles exist.
- Added `npm run db:up`, `npm run db:down`, and `npm test`. Local Postgres uses the non-superuser role `avanza_app` on port 5433.
- No new scheduled jobs. Authentication and role checks are still not implemented.
