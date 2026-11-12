# Backups
Nightly pg_dump to our own storage via .github/workflows/backup.yml. Restore steps: create a spare project, run psql < dump.sql, point a preview deploy at it. Last test restore: 2026-10-30.
