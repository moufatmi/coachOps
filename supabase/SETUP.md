# Supabase setup — run these in order

Open the **SQL Editor** in your Supabase dashboard. For each file below, select
everything already in the editor, paste the file's contents over it, and press
**Run**.

| Order | File | Safe to re-run? |
| --- | --- | --- |
| 1 | `STEP-1-fix-schema.sql` | Yes, any number of times |
| 2 | `STEP-2-ids-to-uuid.sql` | **No** — see below |
| 3 | `STEP-3-rls-policies.sql` | Yes |

---

## Step 1 — always run this

`supabase/STEP-1-fix-schema.sql`

Adds any missing `updated_at`, `owner_id`, `club_id`, `monthly_fee` and
`photo_url` columns, turns Row Level Security on, and creates the indexes.

Every statement is `if not exists` / `if exists`, so it cannot break anything
that already works. Run it even if you think everything is fine — that is the
point.

### Read the report at the bottom

The file ends with two read-only queries. You get two result grids.

**Grid 7a — the `id` column type.** This decides whether you need step 2.

| What you see | What it means | Do this |
| --- | --- | --- |
| `uuid` | Ids are already correct | **Skip step 2**, go to step 3 |
| `bigint` | Old integer ids | **Run step 2** |
| Mixed | Partial migration | **Run step 2** |

**Grid 7b — optional columns.** Should list **22 rows** (11 tables × `updated_at`
and `owner_id`). Fewer means step 1 did not fully apply — tell me.

---

## Step 2 — only if grid 7a said `bigint`

`supabase/STEP-2-ids-to-uuid.sql`

Converts integer ids to UUIDs so two devices signed into the same account can
never overwrite each other's data.

> **Stop and read if grid 7a said `uuid`.** Running this when your ids are
> already UUIDs reassigns every row a new id. Your data is not destroyed, but
> the app will treat the old cloud rows as new ones and you will end up with
> duplicates. Do not run it.

The whole file is one transaction. If anything fails, nothing changes and you
will get an error message — send it to me rather than editing it.

It ends with two read-only reports:

- **Grid 8a** — every `id` should now read `uuid`
- **Grid 8b** — row counts. Compare them against what you expect. If a count is
  zero that should not be zero, **stop and tell me before continuing.**

---

## Step 3 — run once, after step 1

`supabase/STEP-3-rls-policies.sql`

**This is the security boundary.** The Supabase anon key is in the browser
bundle and is public. These policies are the only thing stopping it from reading
every coach's players' phone numbers and payment records. Do not skip this file.

Safe to re-run — it drops each policy before recreating it.

Ends with a report that should list **10 rows**, one per table.

---

## After all three

1. Deploy the app (it is already pushed to `main`).
2. Open the app, **sign out, then sign in again**. This clears the expired token
   that is currently in your browser.
3. Go to Settings → **مزامنة الآن** (Sync now).

Archives should now populate on both devices.

---

## If something goes wrong

Send me the **exact error message**. Do not edit the SQL to work around it —
these scripts are ordered around Postgres type rules, and a changed line usually
produces a second, more confusing failure further down.

Your local data (in the browser) is unaffected by anything in this document.
These scripts only touch the cloud copy, which the app can rebuild from the
device that has your real work on it.