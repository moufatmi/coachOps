# CoachOps — Architecture

Reference for developers working on this codebase. Read this before changing the
data model, the sync engine, or anything under `lib/`.

For setup instructions see [README.md](./README.md). For the SQL schema see
[`supabase/schema.sql`](./supabase/schema.sql).

---

## 1. What this is

An offline-first, installable (PWA) web app for football coaches and club
managers. Arabic UI, RTL layout, WhatsApp as the primary communication channel,
prices in Moroccan dirhams.

It is used on a touch device at a training pitch, frequently with poor or no
connectivity. **That constraint drives most of the design decisions below.**

---

## 2. The domain model (the "pyramid")

Everything belongs to exactly one coach, arranged in a four-level hierarchy:

```
Coach                (1 row per auth user, keyed by auth uid)
└── Club             (a coach may work for several)
    └── Age group    (a "team"; several per club)
        ├── Players           (squad)
        ├── Sessions          (schedule)  1──n Attendance
        ├── Lineups           (tactical)   + results / scorers / MVP
        ├── Cotisations       (monthly fees)
        ├── Expenses
        └── Evaluations       (per-player ratings)
```

**Why one filter is enough.** Every table except `clubs`/`coach_profiles` hangs
off `teams` via `team_id`. So ownership scoping is applied in exactly one place —
the `teams` query in `components/pyramid-provider.tsx` — and every other page
that filters by `team_id` inherits it. Do not add `owner_id` filters to page
queries; that duplication is what this design avoids.

The coach's selected club and age group persist in `localStorage` so a refresh or
reopening the installed PWA returns to the same place.

---

## 3. Layers

| Path | Responsibility |
| --- | --- |
| `app/` | Routes only. Almost every page is a thin wrapper around a component. |
| `components/<feature>/` | Feature UI. All are client components. |
| `components/*-provider.tsx` | Cross-cutting state: auth, sync, hierarchy. |
| `lib/offline/` | Dexie schema, hierarchy reconciliation, ownership, backup, seed. |
| `lib/supabase/` | Lazy client + the sync engine. |
| `public/sw.js`, `manifest.json` | PWA shell. |

### Provider order matters

`app/layout.tsx` nests them deliberately:

```
AuthProvider          → who is signed in
  └─ SyncProvider     → needs a session before pushing
    └─ PyramidProvider→ needs the user id before loading clubs/groups
      └─ ModeProvider → training or match
        └─ AppShell   → gates rendering on the session, owns navigation
```

`AuthProvider` must be outermost because `SyncProvider` reads the session, and
`PyramidProvider` reads the user id to load the hierarchy.

`ModeProvider` is the navigation mode — training (the week: schedule, attendance,
money) or match (match day: XI, clock, result). It reads localStorage through
`useSyncExternalStore` rather than `useState` + `useEffect`: the sidebar must
render the right menu on the first paint, and an effect that calls `setState`
guarantees a first render with the wrong menu.

### State scoping

- `usePyramid()` — the whole chain. Use on the home page and navigation.
- `useTeam()` — scoped to the selected age group. Use on squad/schedule/
  attendance/tactical/finance pages. It is a thin adapter over `usePyramid()`.
- `useAuth()` / `useOwnerId()` — session, and the id to stamp on new rows.
- `useSync()` — sync state plus `pushNow()` / `pullNow()`.

---

## 4. Local data (Dexie)

`lib/offline/db.ts` defines all types and the schema. Database name:
`CoachOpsDB_v7` (the name changed at v7; see §4.1). Current version: **7**.

| Version | Adds |
| --- | --- |
| 1 | teams, players, sessions, attendance |
| 2 | lineups |
| 3 | cotisations, expenses |
| 4 | evaluations |
| 5 | `owner_id` index on every table |
| 6 | `clubs`, `coach_profiles`, `teams.club_id` |
| 7 | UUID string primary keys (replaced auto-increment ints) |

Dexie does **not** validate row shapes. TypeScript types are the only guard, and
`position` in particular is a free-form `string` on purpose (the database column
is `text`). New rows must be given an `owner_id` at creation — see §7.

### Two shared base types

- `Owned` — `id?`, `owner_id?`, `updated_at?`. Every syncable row extends it.
- `CoachProfile` — keyed by the auth uid (`id: string`), so it has no
  `owner_id` and is excluded from ownership sweeps.

### 4.1 Two Dexie footguns

**v7 changed the database name.** Dexie cannot change a primary key on an
existing store — declaring string keys for a store that already had integer keys
fails at open with `UpgradeError: Not yet support for changing primary key`, and
no version number can satisfy it. The app therefore opens `CoachOpsDB_v7` and
`migrateFromLegacyDb()` copies rows out of the old `CoachOpsDB` on first load,
assigning fresh UUIDs and remapping every foreign key (including the player ids
nested in lineup `slots`, `substitutes` and `scorers`).

`deleteLegacyDb()` exists but is deliberately not called automatically, so a
partial migration can never destroy the original.

**`EntityTable` types `id` as optional.** TypeScript will not catch `.add()` or
`.bulkAdd()` without an `id`, and Dexie will happily store the row — the failure
surfaces later as rows that never sync. Grep for `.add(`/`.bulkAdd(` when
reviewing, and pass `newId()`.

### 4.2 Player photos

`players.photo_url` holds a **base64 JPEG data URL**, not a Storage object URL.

The reasoning, since it looks like a mistake otherwise: a bucket upload requires
connectivity, so a coach adding a photo at training would see nothing until they
got signal. Inline, the photo is part of the row the sync engine already moves,
so it appears on the second device with everything else.

Photos must stay small, so `lib/offline/photo.ts` re-encodes on the device:
centre-cropped square, 256px, JPEG q0.82, stepping down in quality until under
400KB. Roughly 15-25KB each.

---

## 5. Sync engine

`lib/supabase/sync.ts`. Local Dexie is the source of truth; Supabase is an
optional backup target.

**Push** stamps `updated_at` (and `owner_id`) on every row, then upserts per
table. **Pull** merges row by row and overwrites a local row only when the cloud
copy is strictly newer — it never clears tables. A pull therefore cannot destroy
unsynced local work.

`components/sync-provider.tsx` listens for Dexie's `storagemutated` event,
debounces 10s, and pushes when online. It ignores mutations for a short window
after each sync, because the push itself writes `owner_id`/`updated_at` back
locally and would otherwise retrigger forever.

### Known limitations

- **Deletions do not propagate.** There are no tombstones, so a player deleted on
  one device returns on the next pull from another.
- **Timestamps are stamped at push time**, not at edit time. Push from every
  device you edit on.
- **Pull before working on a second device** — primary keys must agree.

---

## 6. Auth and security

Email/password via Supabase Auth. RLS (`supabase/schema.sql`) scopes every table
to the signed-in coach:

```sql
create policy "own players" on players for all
  using      (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
```

`coach_profiles` is the exception: it is keyed by the auth uid, so its policy
matches on `id` instead.

**What this protects:** cloud data. The anon key ships in the client bundle, so
without RLS any visitor could read every coach's phone numbers and payment
records.

**What it does not protect:** local data. Rows live in IndexedDB on the device.
Signing out clears nothing; the app simply hides it. On a shared phone, use
device-level protection. This is a UI lock, not encryption.

### Pre-auth data migration

Rows created before auth existed have no `owner_id`. `claimUnownedRows()` adopts
them on first sign-in. Cloud rows left over from before RLS need the manual
`update … set owner_id` block documented at the bottom of `schema.sql`.

---

## 7. Gotchas

These caused real, hard-to-diagnose bugs during development. Each one fails
silently or with a misleading error.

### 1. `id` must be `generated by default`

```sql
-- WRONG: rejects every push
id bigint generated always as identity primary key
-- RIGHT
id bigint generated by default as identity primary key
```

Dexie assigns primary keys locally and sync pushes them, so `player_id` /
`team_id` / `session_id` stay valid across devices. `GENERATED ALWAYS` refuses
explicit ids and fails the whole upsert:

```
428C9  cannot insert a non-DEFAULT value into column "id"
```

The `alter table … drop identity / add generated by default` migration plus a
`setval` is at the bottom of `schema.sql`. **Do not skip the `setval`** —
re-adding an identity resets the sequence to 1 and collides with existing ids.

### 2. Every synced table needs `updated_at`

The engine stamps and compares `updated_at` on every table it pushes. A missing
column fails that entire table:

```
PGRST204  Could not find the 'updated_at' column of 'clubs' in the schema cache
```

### 3. New columns on existing tables need an explicit `ALTER`

`create table if not exists foo (...)` is a **no-op** if `foo` already exists, so
columns added to that block never appear. Always add a matching
`alter table foo add column if not exists …`.

### 4. The Supabase client must stay lazy

`lib/supabase/client.ts` builds the client on first call and returns `null` when
unconfigured. It must never throw at module scope — that previously crashed
every page that transitively imported it, including pages that never needed
Supabase. Sync reports "not configured" as a normal error instead.

### 5. Stamp `owner_id` on every new row

Use `useOwnerId()`. An unowned row is adoptable by the *next* account to sign in
on the same device, and sync would stamp it with that account's id and push it
into the wrong cloud account.

### 6. `.env.local` must use `=`

A `:` instead of `=` makes dotenv drop the variable **silently**. This looked
exactly like a missing key. There must be no BOM and no quoting.

### 7. `db.teams.count()` counts other coaches' teams

Guard seeding and per-user logic on the coach's own rows, never the global count.
Otherwise a second coach on one browser gets no data and cannot save anything.

---

## 8. Local development

```bash
npm install
npm run dev            # http://localhost:3000
npm run build
npm run lint
npx tsc --noEmit
```

### Environment variables

Only three are read, all optional-but-required-in-practice:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY        # falls back to PUBLISHABLE_KEY
```

`.env*` is gitignored. Never commit a `service_role` key — it bypasses RLS and
`NEXT_PUBLIC_*` values are published to every browser.

### First-time setup

1. Run `supabase/schema.sql` in the Supabase SQL editor. It is idempotent and
   safe to re-run.
2. Supabase → Authentication → Providers → enable **Email** (disable "Confirm
   email" while testing).
3. Add the env vars, then `npm run dev` and create an account.

### Deploying to Vercel

Set the two env vars in Project → Settings → Environment Variables for all
environments, **before** the first deploy. `NEXT_PUBLIC_*` values are inlined at
build time, so Vercel must rebuild after they are added.

---

## 9. Conventions

- All UI strings are Arabic, hardcoded. There is no i18n layer yet.
- Components are client components; there are no server components or route
  handlers, because all data lives in IndexedDB.
- Styling is Tailwind v4 utilities plus `cn()` (`clsx` + `tailwind-merge`).
- React state derived from props is adjusted **during render** behind a guard,
  not in an effect — `react-hooks/set-state-in-effect` is treated as an error.
  To reset state when a prop changes, remount with `key`.
- UI copy is Arabic; code, comments and commit messages are English.

---

## 10. Error → cause quick reference

| Error | Cause |
| --- | --- |
| `428C9 cannot insert a non-DEFAULT value into column "id"` | Table still uses `generated always` |
| `PGRST204 Could not find the 'updated_at' column of 'x'` | New table missing `updated_at` |
| `42703 column "club_id" does not exist` | `create table if not exists` was a no-op; add the `ALTER` |
| `42501 new row violates row-level security policy` | Signed out, or pushing a row owned by a different account |
| `Missing NEXT_PUBLIC_SUPABASE_URL or …` | A `:` in `.env.local`, or a BOM |
| `23503 violates foreign key constraint "teams_club_id_fkey"` | The parent `clubs` row was never created |
| Data saves locally but never reaches Supabase | Sync is debounced 10s — check the header indicator first |