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
- Every state change writes to the audit log once that log exists.
- No hard deletes of employee data. Use status or a soft delete.
- No self-approval.
- Business logic lives in `src/lib/services`, not in components.
- Build only what the current prompt asks.
- Ask before making big assumptions.
- Keep `README.md` current when setup, features, roles, env vars, scheduled jobs, or commands change.

## Build steps

Steps 2–9 follow the areas named in the project brief. Rename a step if a later prompt scopes it differently.

- [x] 1. Scaffold the project and build the app shell
- [ ] 2. Authentication, roles, and server-side permission checks
- [ ] 3. Audit log
- [ ] 4. Employee records (status / soft delete, no hard deletes)
- [ ] 5. Directory and People (HR)
- [ ] 6. My Space: profile and documents
- [ ] 7. Attendance and holidays
- [ ] 8. Leave, approvals (no self-approval), inbox, and my team
- [ ] 9. Reports and settings

## Step 1 notes

- App shell, theme tokens, shared components, Prisma skeleton, and env placeholders are in place.
- No business logic, models, auth, or scheduled jobs.
- Sidebar role lists are stored on each item and not enforced.
