# Storage Backup & Restore Runbook

Status: **NOT CONFIGURED — launch blocker.** The owner deferred backups until before the client launch. Until this runbook is completed and a restore test passes:

- Files on `/var/lib/bulkimart` live on the VPS root disk only (`/dev/sda1`). A disk failure, accidental deletion or VPS loss loses them.
- For migrated assets, the Cloudinary originals are the only other copy — they must not be deleted.
- Files uploaded after a category is switched to the server (new KYC documents, product images, e-books, service documents) have **no second copy**.

## What must be backed up

| Data | Location | Notes |
|---|---|---|
| Media files | `/var/lib/bulkimart/media/public`, `/private` | `temp/` and `quarantine/` optional |
| E-books | `/var/lib/bulkimart/ebooks` | Paid content |
| Service / legal / GST documents | `/var/lib/bulkimart/services` | Private |
| Metadata | MongoDB collections `media`, `mediaaccessaudits`, `mediamigrationlogs` plus all business collections | Hosted MongoDB (not on this VPS): confirm its backup policy and retention |

Files and metadata must be restorable to the same point in time (run file backup shortly after the database snapshot, or vice versa, and record both times).

## Required before launch

1. **Hostinger VPS backups/snapshots** — enable in the Hostinger panel; record frequency and retention. Snapshots protect against VPS loss but are coarse; they are not a substitute for step 2.
2. **Independent off-server file backup** — `rclone` is already installed. Choose a destination outside this VPS (owner decision: another server via SFTP, or a storage account). Encrypt at rest (`rclone crypt` remote). Example nightly job once a crypt remote named `bulkimart-backup-crypt` (see STORAGE_FINAL_SERVER_COMMANDS.md §L) exists:
   ```bash
   # /etc/cron.d/bulkimart-media-backup
   30 2 * * * root rclone sync /var/lib/bulkimart bulkimart-backup-crypt:current --exclude "media/temp/**" --backup-dir bulkimart-backup-crypt:deleted/$(date +\%Y\%m\%d) --log-file /var/log/bulkimart-media-backup.log --log-level INFO
   ```
   `--backup-dir` keeps deleted/overwritten files for retention instead of mirroring deletions away.
3. **Retention** — at least 30 daily versions; prune `deleted/` older than 90 days.
4. **Monitoring** — alert if the backup log has no successful run in 26 h; disk alerts (the app already logs `[MEDIA] … below the free-space reserve` hourly and refuses uploads below `MEDIA_MIN_FREE_BYTES`).
5. **Restore test (non-destructive)** — never restore over production:
   ```bash
   mkdir -p /root/restore-test && rclone copy bulkimart-backup-crypt:current/media/private /root/restore-test/private --max-age 72h
   # pick 20 media records and compare sha256 with the restored files, e.g.:
   sha256sum /root/restore-test/private/seller-documents/<yyyy>/<mm>/<file>
   rm -rf /root/restore-test
   ```
   Record date, sample size and result below.

## Restore procedure (real incident)

1. Stop uploads: set `MEDIA_PROVIDER_DEFAULT=cloudinary`, remove `MEDIA_PROVIDERS`, restart (KYC: see rollback runbook §2 exception).
2. Restore files into a new directory, verify hashes against `media` records (`node scripts/media/migrate.mjs verify --database=<db>` after pointing `MEDIA_ROOT` at it).
3. Point `MEDIA_ROOT` (and e-book/service dirs) at the restored location, restart, re-enable providers.

## Restore test log

| Date | Scope | Files checked | Result | By |
|---|---|---|---|---|
| — | — | — | not yet performed | — |
