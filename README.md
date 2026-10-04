# CoachOps — كوتش أوبس

An offline-first Arabic (RTL) web app for football coaches and club managers.
Roster, training sessions, attendance, tactical lineups, subscriptions and
expenses — usable on a phone at the pitch with no signal, and installable as a
PWA.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19 |
| Styling | Tailwind CSS v4 |
| Local data | Dexie / IndexedDB (`CoachOpsDB`), live queries via `useLiveQuery` |
| Cloud sync | Supabase (Postgres), auto-push + manual pull |
| Auth | Supabase Auth, coach-scoped RLS |
| PWA | `public/manifest.json` + `public/sw.js` |

> **Developers:** see [ARCHITECTURE.md](./ARCHITECTURE.md) for the data model,
> sync semantics, provider layering, and a list of footguns that fail silently.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint     # eslint
npx tsc --noEmit # type check
```

The app seeds a sample U15 team on first run, so there is data to explore
immediately. Settings → *إعادة الضبط* clears it.

## Layout

```
app/                 routes (all client components, offline-first)
components/          feature components: attendance, finance, lineup,
                     match, schedule, settings, teams
lib/offline/         Dexie schema (db.ts), hierarchy, ownership, backup, seed
lib/supabase/        client + sync engine
supabase/schema.sql  run once in the Supabase SQL editor (idempotent)
```

## How data works

Everything belongs to one coach, arranged as **coach ▸ club ▸ age group ▸ squad
and activity**.

The local Dexie database is the source of truth. Supabase is an optional
backup/sync target; changes upload automatically about 10 seconds after you make
them, and Settings has manual push/pull. Sync uses **last-write-wins per row** on
an `updated_at` column:

- **Push** stamps any row missing `updated_at` and upserts everything.
- **Pull** merges row by row and only overwrites a local row when the cloud
  copy is strictly newer — pulling cannot discard unsynced local edits.

Known limitations, by design:

- **Deletions do not propagate.** There are no tombstones, so a player deleted
  on one device stays in the cloud and returns on the next pull from another.
- **IDs must be kept in sync** between devices. Pull before working on a second
  device.
- Rows that have never been pushed have no `updated_at` and are always treated
  as older, so cloud data never clobbers them on the first pull.

## Accounts and security

Sign-in is email/password via Supabase Auth. Every table carries an `owner_id`,
and Row Level Security policies in `supabase/schema.sql` restrict all access to
the signed-in coach:

```sql
create policy "own players" on players for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
```

Because every other table is reached through an age group, the app applies the
owner filter once — on the team list in `components/pyramid-provider.tsx` — which
keeps one coach's roster off another coach's screen.

### What this does and does not protect

- **Cloud data is protected.** RLS is enforced server-side, so the anon key in
  the client bundle cannot read or write another coach's rows, including
  parents' phone numbers and payment records.
- **Local data is gated, not encrypted.** Rows live in IndexedDB on the device
  and keep their `owner_id` on sign-out, so signing back in restores your work
  and another coach sees an empty app. But this is a UI lock only: anyone with
  devtools access to that browser profile can read IndexedDB directly. Use
  device-level protection for a shared phone.

### Adopting pre-auth data

Rows created before auth existed have `owner_id = NULL`. Your first sign-in
claims any local rows automatically. Rows already pushed to the cloud from
before auth must be claimed once by hand — see the commented `update` block at
the end of `supabase/schema.sql`.

## First-time setup

1. Run `supabase/schema.sql` in the Supabase SQL editor.
2. In Supabase → Authentication → Providers, enable **Email**. Turn off
   "Confirm email" if you want to skip inbox verification during testing.
3. Put the project URL and anon key in `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   ```
   Both keys must use `=`. A stray `:` is silently ignored and the variable
   disappears without warning.
4. `npm run dev`, create an account, then use Settings → sync.

## License

Private project.