# Storage Backup & Restore Runbook

Status: **NOT CONFIGURED — client-launch blocker.** The owner deferred backups until before the client launch. Until §2–§6 are done and the restore test in §5 has passed:

- Files under `/var/lib/bulkimart` exist only on the VPS root disk (`/dev/sda1`). A disk failure, accidental deletion or loss of the VPS loses them.
- For migrated assets the Cloudinary originals are the only other copy — they must not be deleted.
- Files uploaded after a category moves to the server (new KYC documents, product images, e-books, service documents) have **no second copy**.

Exact commands: [STORAGE_FINAL_SERVER_COMMANDS.md](STORAGE_FINAL_SERVER_COMMANDS.md) §L.

## 1. What must be backed up

| Data | Location | Notes |
|---|---|---|
| Public media | `/var/lib/bulkimart/media/public` | product, review, branding, banners, storefront, … |
| Private media | `/var/lib/bulkimart/media/private` | KYC, bank, landmarks, returns, tickets |
| Quarantine | `/var/lib/bulkimart/media/quarantine` | kept for investigation; small |
| E-books | `/var/lib/bulkimart/ebooks` | paid content |
| Service / legal / GST documents | `/var/lib/bulkimart/services` | private |
| File manifests | `/var/lib/bulkimart/reports/manifest-*.sha256` | SHA-256 of every file at backup time |
| Media metadata | MongoDB `media`, `mediaaccessaudits`, `mediamigrationlogs` | without these, `media:<id>` references and signed links cannot be resolved |
| Business records | every other MongoDB collection | e-book and service files are referenced from `products`, `orders`, `serviceapplications`, `gstassistancerequests`, … |

Not backed up: `media/temp` (in-flight uploads, swept after 24 h).

## 2. Requirements

- **Off-server and encrypted.** Destination outside the Hostinger VPS (another server via SFTP, or a storage account), wrapped in an `rclone crypt` remote so the provider only sees ciphertext.
- **Keys off the server.** The remote's credentials and the crypt password + salt are stored in the owner's password manager, not only in `/root/.config/rclone/rclone.conf`. Test that they decrypt from a second machine.
- **Version retention.** At least 30 daily versions and 12 monthly; deleted files kept ≥ 90 days.
- **Failure monitoring.** An alert reaches a person when a nightly run fails or has not succeeded for 26 hours.
- **A real restore test** (§5) passes before backups are called configured, and is repeated quarterly.

## 3. Procedure

### 3.1 Remotes (once)
`rclone config` → remote `bulkimart-backup` (the off-server destination) → `crypt` remote `bulkimart-backup-crypt` over `bulkimart-backup:bulkimart`, filename encryption on. Record the passwords off-server.

### 3.2 Manifest, then first file backup
1. Write a SHA-256 manifest of every file (§L command 2).
2. First backup with **`rclone copy`** (§L command 3).

Direction and deletion behaviour of the commands used:

| Command | Direction | Deletes on destination? | Use |
|---|---|---|---|
| `rclone copy /var/lib/bulkimart remote:current` | VPS → remote | **Never.** Adds new files, updates changed ones | first backup and nightly job |
| `rclone copy … --backup-dir remote:versions/<date>` | VPS → remote | Never; a file that would be overwritten is moved to `versions/<date>/` first | nightly job (version retention) |
| `rclone copy remote:current /root/restore-test` | remote → scratch folder | Never touches `/var/lib/bulkimart` | restore test |
| `rclone sync` | — | **Yes** — removes remote files missing on the VPS | **not used** (a deletion or mistake on the VPS would propagate to the backup) |

Media files are write-once (random UUID names, never overwritten in place), so `copy` keeps every file that ever existed until retention prunes it.

### 3.3 MongoDB metadata
MongoDB is hosted off this VPS. Two layers:
1. **Provider backups** of the whole cluster — confirm they are enabled, their frequency and retention, and that a point-in-time restore is possible. Record it below.
2. **Nightly dump of the media collections** taken right after the file backup, so files and metadata can be restored to a compatible point:
   ```bash
   command -v mongodump || echo "mongodump not installed: install MongoDB Database Tools (owner approval)"
   ```
   Keep the connection string out of the process list by putting it in a 0600 config file (written without printing it):
   ```bash
   umask 077 && printf 'uri: "%s"\n' "$(grep -E '^MONGO_URI=' /root/bulkimart/backend/.env | cut -d= -f2- | sed 's/^"//; s/"$//')" > /root/.bulkimart-mongodump.yaml
   D=$(date +%Y%m%d-%H%M) && for c in media mediaaccessaudits mediamigrationlogs; do mongodump --config=/root/.bulkimart-mongodump.yaml --collection=$c --archive=/var/lib/bulkimart/reports/db-$c-$D.archive.gz --gzip; done
   rclone copy /var/lib/bulkimart/reports bulkimart-backup-crypt:current/reports --include "db-*.archive.gz" --include "manifest-*.sha256"
   ```
   The `mongodump` loop needs the database name in the URI (it is part of the existing `MONGO_URI`).

### 3.4 Schedule and monitoring
- Nightly file job: §L command 4 (cron at 02:30, writes `reports/last-backup-ok` on success).
- Add the manifest and metadata dump to the same nightly run (before the `rclone copy`) once `mongodump` is available.
- Monitoring: an hourly check that raises an alert when `reports/last-backup-ok` is older than 26 h or the log contains `ERROR`. The alert channel (email, SMS, uptime service) is an owner decision; until it exists, check the log daily.

### 3.5 Retention
Weekly: delete `versions/<date>` folders older than 90 days on the remote (`rclone purge bulkimart-backup-crypt:versions/<date>`), keeping the first of each month for 12 months. Never prune `current/`.

## 4. Point-in-time compatibility

A restore must bring back files and metadata from the **same night**:
1. Restore the files from `current/` (and `versions/<date>/` if an older state is needed).
2. Restore `media`, `mediaaccessaudits`, `mediamigrationlogs` from the dump of that night (`mongorestore --archive --gzip --nsInclude`), or the cluster from the provider's point-in-time backup taken just after it.
3. Run `migrate.mjs verify --scope=all --root=<restored media dir>`: every `media` record must find its file with the right size, SHA-256 and type. Files present without a record are harmless; records without files are reported and must be resolved before going live.

## 5. Non-destructive restore test (required before launch)

Never restore over `/var/lib/bulkimart`. Commands: §L command 5.
1. Copy the whole backup to `/root/restore-test`.
2. `sha256sum -c` against the latest manifest → every restored file matches.
3. `migrate.mjs verify --scope=all --root=/root/restore-test/media` → every database record's file is present and intact.
4. Restore the latest `media` dump into a **scratch database** on the same cluster (never the live one) and compare document counts with the live collections.
5. Delete the scratch folder and scratch database. Record the result below.

## 6. Recovery after a real incident

1. Pause uploads: set every category to `"disabled"` (the KYC categories may only be `server` or `disabled`; never route them to Cloudinary). Reading stays available for whatever is still on disk.
2. Restore files into a **new** directory (for example `/var/lib/bulkimart-restored`), then verify as in §4.3 with `--root=/var/lib/bulkimart-restored/media`.
3. If metadata was lost, restore the matching night's dump (§4.2).
4. Point `MEDIA_ROOT`, `EBOOK_STORAGE_DIR` and `SERVICE_STORAGE_DIR` at the restored directories, restart, check, then re-enable the upload categories.
5. Keep the damaged originals untouched for investigation.

## Records

| Item | Value | Confirmed by | Date |
|---|---|---|---|
| Off-server destination | — | | |
| Crypt password + salt stored off-server | — | | |
| Hostinger VPS backups/snapshots | — | | |
| Hosted MongoDB backup + retention | — | | |
| Alert channel | — | | |

### Restore test log

| Date | Files checked | DB records checked | Result | By |
|---|---|---|---|---|
| — | — | — | not yet performed | — |
