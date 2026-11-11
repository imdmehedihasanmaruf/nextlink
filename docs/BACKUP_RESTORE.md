# NextLink Global — PostgreSQL Backup & Restore Runbook

This runbook covers the `nextlink_db` PostgreSQL database and the two
filesystem mirrors (`backend/data/siteData.json`, `backend/data/adminStore.json`).
The admin panel also ships a one-click JSON export (logged-in super_admin → CMS →
Backup). The database dump below is the authoritative backup.

## 1. Backup schedule & retention

| Backup | Where | Retention |
|--------|-------|-----------|
| Daily automated `pg_dump` | `C:\Backups\nextlink\nextlink_YYYY-MM-DD_HHMM.dump` | 30 days |
| Weekly compressed full dump | `S:\backups\nextlink\nextlink_YYYY-WW.dump.gz` | 12 weeks |
| Admin panel JSON export | manual download | as operator keeps |

Backups **must not** be stored inside this repository.

## 2. Run an ad-hoc backup now

```powershell
# Full, self-contained custom-format dump (recommended)
pg_dump -h localhost -U postgres -d nextlink_db -F c -f C:\Backups\nextlink\nextlink_$(Get-Date -Format yyyy-MM-dd_HHmm).dump
```

Requirements:
- PostgreSQL client tools (`pg_dump.exe`) version ≥ the server major version.
- A dedicated OS account with `REPLICATION` (or the `postgres` superuser).
- The password supplied via `PGPASSWORD`env or `.pgpass` — **never** inside the
  script.

## 3. Verify a backup

```powershell
# List objects contained in the dump
pg_restore --list C:\Backups\nextlink\nextlink_2026-11-11_0400.dump | Select-Object -First 20
# Dry-restore into a scratch database to prove the dump is usable
createdb -h localhost -U postgres nextlink_restore_test
pg_restore -h localhost -U postgres -d nextlink_restore_test --clean --if-exists C:\Backups\nextlink\nextlink_2026-11-11_0400.dump
# Sanity-check counts
psql -h localhost -U postgres -d nextlink_restore_test -c "SELECT count(*) FROM subscribers"
# Tear down the scratch database
dropdb -h localhost -U postgres nextlink_restore_test
```

A backup that has not been restored into a scratch database is **not** verified.

## 4. Restore procedure (destructive — approval required)

1. Stop the three NextLink services and the API.
2. Take a fresh pre-restore dump of the current state (never skip this):
   `pg_dump -h localhost -U postgres -d nextlink_db -F c -f C:\Backups\nextlink\pre-restore_$(Get-Date -Format yyyy-MM-dd_HHmm).dump`
3. Restore:
   `pg_restore --clean --if-exists -h localhost -U postgres -d nextlink_db <backupfile>`
4. Re-run additive migrations: `node backend\api\scripts\migrate.js`
5. Re-run the verification suite:
   `cd C:\Users\User\Downloads\nextlink\backend\api; npm test`
6. Re-start services and verify:
   - portal login (`http://localhost:3001/login`)
   - admin panel (`http://localhost:8000/login`)
   - `/health` on the API reports `"database":"connected"`
7. Delete or quarantine the pre-restore dump only after sign-off.

## 5. Failure notifications

- The backup script exits non-zero on any error. Wrap it in a scheduler
  (Windows Task Scheduler / cron) that emails on failure.
- Minimum check to script: `pg_dump` exit code **and** `pg_restore --list` output
  row count must be > 0.
- Store the last run status in `C:\Backups\nextlink\last-run.log` and alert if it
  is older than 25 hours.

## 6. Migration recovery

- All migrations are **additive** (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE …
  ADD COLUMN IF NOT EXISTS`). Migrations never drop or rewrite data.
- The pre-restore dump is the rollback strategy. Restore it if an unintended
  additive change is applied.
- For genuinely destructive migrations (none exist today), an explicit
  maintenance-window approval is required.

## 7. Administration-level backup for the UC/file mirrors

The admin panel's JSON export contains: packages, subscribers, invoices (paid
invoices preserved), tickets, technicians, roles, admin users, site content,
and the live staff roster. On restore, the mirror is validated before it is
written and secrets are redacted.

Run `scripts\restore-from-mirror --dry-run` to validate a mirror before any
restore is applied. Do **not** run a mirror restore against production without
a fresh pre-restore dump and an explicit approval.
