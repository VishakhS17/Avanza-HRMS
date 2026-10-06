# Avanza HRMS progress

## Stack

Next.js (App Router) and TypeScript, Tailwind CSS, shadcn/ui, PostgreSQL and Prisma, Auth.js. Web-first, and it should work well on mobile browsers.

## Palette

Defined in `src/app/globals.css`. Components use the tokens, not raw hex values.

| Token | Hex | Use |
| --- | --- | --- |
| `primary` | `#8B1E2D` | Buttons, active nav, key accents |
| `secondary` | `#1E40AF` | Links, info states, secondary actions |
| `background` | `#F4F5F7` | Page background |
| `card`, `sidebar` | `#FFFFFF` | Surfaces |
| Slate scale | `#0F172A` through `#E2E8F0` | Text, muted text, borders |
| `success` | `#166534` | Status badges only |
| `warning` | `#92400E` | Status badges only |

The app is light by default. A `.dark` token set exists and is not switched on.

## Rules

- All permission checks are server-side.
- Every state change writes to the audit log in the same database transaction (`audit.log` in `src/lib/services/audit.ts`).
- No hard deletes of employee data. Use status or a soft delete.
- No self-approval.
- Business logic lives in `src/lib/services`, not in components.
- Build only what the current prompt asks.
- Ask before making big assumptions.
- Keep `README.md` current when setup, features, roles, env vars, scheduled jobs, or commands change.

## Build steps

Steps 2–9 follow the areas named in the project brief. Rename a step if a later prompt scopes it differently.

- [x] 1. Scaffold the project and build the app shell
- [x] 2. Audit log
- [x] 3. Authentication, roles, and server-side permission checks
- [x] 4. Employee records (status / soft delete, no hard deletes)
- [x] 5. Leave, holidays, approvals, and inbox
- [ ] 6. My Space: profile and documents
- [ ] 7. Attendance
- [ ] 8. Reports
- [ ] 9. Settings

## Step 1 notes

- App shell, theme tokens, shared components, Prisma skeleton, and env placeholders are in place.
- No business logic, models, auth, or scheduled jobs.
- Sidebar role lists are stored on each item and not enforced.

## Step 2 notes

- `AuditLog` is append-only. `audit.log` redacts sensitive fields and can take the current transaction client.
- The migration revokes `UPDATE`, `DELETE`, and `TRUNCATE` from the app role. A trigger also rejects update and delete.
- The viewer is `/settings/audit-log` (filters, paging, CSV). Access was a stub in this step and is enforced in step 3.
- `npm run db:up` starts a local non-superuser database. No scheduled jobs.

## Step 3 notes

- Auth.js database sessions. Google and Microsoft Entra sign-in are limited to `AUTH_ALLOWED_EMAIL_DOMAIN` and require an existing active user. The dev password form is disabled in production.
- `can()` in `src/lib/permissions.ts` is used by the proxy, pages, actions, and the sidebar. Managers are scoped to direct reports once employee records exist.
- Settings → Users and roles is Super Admin only. The audit log viewer and CSV export are Super Admin and HR Admin. The step 2 stub gate is replaced.
- Each request checks status, expiry, and idle timeout (shorter for admin roles). This is not a scheduled job. Login, logout, failed login, role changes, and deactivation or reactivation are audited.
- MFA for admin roles is documented in the README and enforced at the SSO provider.

## Step 4 notes

- `Employee` shares its id with `User`. Job data is on `Employment`. One open row per employee uses `openKey` (the employee id while current, null once closed).
- HR people screens, the directory, My Profile contact edits, My Team direct reports, and organization settings are included here.
- Bank details and government IDs are encrypted with `EMPLOYEE_DATA_KEY`. Reveals are HR Admin only and audited. No hard deletes and no scheduled jobs.
- Directory and People shipped in this step. The following prompt took the leave work that had been listed later in the checklist.

## Step 5 notes

- Leave balance is the sum of `LeaveLedger` rows. Submit places a hold. Approval releases the hold and posts a deduction.
- The approver is the reporting manager, or an active HR Admin, then a Super Admin. Self-approval is rejected. A manager can decide only for a current direct report.
- Holiday calendars and the weekly off are per location. Accrual and year-end carry-forward are idempotent CLI jobs: `npm run jobs:leave-accrual` and `npm run jobs:leave-carry-forward`.
- Mail uses a console adapter. There is no SMTP setting.
