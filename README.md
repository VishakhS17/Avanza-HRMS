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
- PostgreSQL, when you start storing data. The shell runs without a database.

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

On Windows PowerShell, copy the env file with `Copy-Item .env.example .env`.

Open [http://localhost:3000](http://localhost:3000).

`npm install` runs `prisma generate`. Postgres is only required for migrations, seeding real data, and later features. Create a database named `avanza_hrms` (or change `DATABASE_URL`) before the first migration.

## Environment variables

| Variable | Required now | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | No, until data features | PostgreSQL connection string |
| `AUTH_SECRET` | No | Reserved for Auth.js |
| `AUTH_URL` | No | Reserved for Auth.js. Defaults to `http://localhost:3000` in code when unset |

Copy `.env.example` to `.env`. Do not commit `.env`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production server |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:migrate` | Create and apply a dev migration (needs Postgres and models) |
| `npm run db:seed` | Run the seed script |
| `npm run db:studio` | Open Prisma Studio |

There are no models or scheduled jobs yet. The seed script prints a message and inserts nothing.

## Project structure

```text
src/app/(app)/          Routes and the app-shell layout
src/components/layout/  Sidebar, top bar, shell
src/components/shared/  PageHeader, DataTable, StatusBadge, EmptyState, ConfirmDialog, FormField
src/components/ui/      shadcn/ui primitives
src/lib/                env, database client, navigation
src/lib/services/       Business logic (empty until later steps)
prisma/schema.prisma    Database schema
prisma/seed.ts          Seed skeleton
prisma7.config.ts       Prisma 7 config
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

Permission checks will be server-side. No one will approve their own requests.

## Rules

- Permission checks run on the server.
- State changes will be written to the audit log once that log exists.
- Employee data is not hard-deleted. Use status or a soft delete.
- Business logic belongs in `src/lib/services`, not in components.

## Changelog

### 2026-10-05

- Scaffolded Next.js, TypeScript, Tailwind, shadcn/ui, Prisma, env handling, and a seed skeleton.
- Added Avanza theme tokens, the app shell, sidebar sections, and shared UI components.
- Reserved `AUTH_SECRET` and `AUTH_URL` for Auth.js. Authentication is not implemented.
- No roles, permissions, audit log, models, or scheduled jobs yet.
