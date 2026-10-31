# Storage — Final Server Commands

For: the operator of the Hostinger VPS `srv2104110` (Ubuntu 24.04, root, repo `/root/bulkimart`, PM2 `bulkimart-api`, API `https://api.bulkimart.in`).

Run sections **in order**. Each command lists its purpose, the expected result and whether it **changes production**. Stop at the first unexpected result and send the output back. Nothing here deletes Cloudinary assets, Cloudinary configuration or existing records.

> **Prerequisite (development machine, needs owner approval):** the code is not yet in Git. Commit and push branch `storage/server-media` using [STORAGE_DEPLOYMENT_RUNBOOK.md](STORAGE_DEPLOYMENT_RUNBOOK.md) §0. Until `git ls-remote` in C1 shows the branch, stop after section B.

---

## A. Initial inspection — read-only, no production change

```bash
cd /root/bulkimart && lsb_release -ds && df -h / && df -i /
```
Purpose: OS and free disk/inodes. Expected: Ubuntu 24.04.5 LTS; `/dev/sda1` with well over 50 GB free, inode use in single digits.

```bash
cd /root/bulkimart && git branch --show-current && git log -1 --oneline && git status --short
```
Purpose: current deployed version. Expected: `main`, `eb15e59 native user` (or newer), and only ` M deploy.sh` changed.

```bash
pm2 ls && curl -s -o /dev/null -w 'API health: %{http_code}\n' https://api.bulkimart.in/api/health
```
Purpose: process and API up. Expected: `bulkimart-api` online; `API health: 200`.

```bash
grep -oE '^(CLOUDINARY_[A-Z_]+|MEDIA_[A-Z_]+|EBOOK_STORAGE_DIR|SERVICE_STORAGE_DIR|NODE_ENV)=' /root/bulkimart/backend/.env | sort | uniq -c
```
Purpose: which storage settings exist — **names only, values never printed**. Expected now: the three `CLOUDINARY_*` names and `NODE_ENV`, each once; no `MEDIA_*` yet.

```bash
ls -la /var/lib/bulkimart 2>&1; ls -d /root/bulkimart/backend/uploads /root/bulkimart/backend/private-data/* 2>&1
```
Purpose: existing media on disk. Expected (from last audit): all "No such file or directory".

## B. Storage directory setup — creates empty directories only; no app change

```bash
mkdir -p /var/lib/bulkimart/media/public /var/lib/bulkimart/media/private /var/lib/bulkimart/media/temp /var/lib/bulkimart/media/quarantine /var/lib/bulkimart/ebooks /var/lib/bulkimart/services /var/lib/bulkimart/reports
chown -R root:root /var/lib/bulkimart
chmod 750 /var/lib/bulkimart /var/lib/bulkimart/media /var/lib/bulkimart/media/public
chmod 700 /var/lib/bulkimart/media/private /var/lib/bulkimart/media/temp /var/lib/bulkimart/media/quarantine /var/lib/bulkimart/ebooks /var/lib/bulkimart/services /var/lib/bulkimart/reports
ls -la /var/lib/bulkimart /var/lib/bulkimart/media
```
Purpose: approved persistent location, outside the repo and web root. Owner is `root` because the API runs as root (PM2 user `root`); only `/var/lib/bulkimart` is touched. Expected: `drwxr-x---` for public dirs, `drwx------` for private/temp/quarantine/ebooks/services/reports.

```bash
grep -n "var/lib/bulkimart" /root/bulkimart/deploy.sh || echo "OK: deploy.sh never touches /var/lib/bulkimart"
grep -nE "rsync .*--delete|rm -rf" /root/bulkimart/deploy.sh
```
Purpose: prove deployment cannot delete media. Expected: the `OK` line; the `rsync --delete`/`rm -rf` lines shown all target `$WEB_ROOT` (`/home/bulkimart/htdocs/bulkimart.in`) or the deploy backup dir, never `/var/lib`.

```bash
touch /var/lib/bulkimart/media/temp/.write-test && rm /var/lib/bulkimart/media/temp/.write-test && echo "OK: writable by root (the PM2 user)"
```
Purpose: the API user can write. Expected: `OK: writable…`.

## C. Git and application deployment

**C1 — read-only:** confirm the branch exists on GitHub.
```bash
cd /root/bulkimart && git fetch origin && git ls-remote --heads origin storage/server-media
```
Expected: one line ending `refs/heads/storage/server-media`. **If empty: stop — the prerequisite has not been done.**

**C2 — read-only:** confirm the branch contains the storage implementation and nothing from `mobile-user/`.
```bash
cd /root/bulkimart && git diff --stat origin/main...origin/storage/server-media | tail -5
git diff --name-only origin/main...origin/storage/server-media | grep -c '^backend/services/media'
git diff --name-only origin/main...origin/storage/server-media | grep '^mobile-user/' || echo "OK: no mobile-user changes"
```
Expected: about 50 files changed; `7` media service files; `OK: no mobile-user changes`.

**C3 — changes the checked-out code on production, no restart yet** (the running process keeps the old code in memory until G1):
```bash
cd /root/bulkimart && git checkout -b storage/server-media origin/storage/server-media && git log -1 --oneline && git status --short
```
Expected: switched to the branch; `git status` still shows only ` M deploy.sh` (local change preserved).

**Do not run `deploy.sh`** in this phase: it deploys `main`. It may be used again only after the branch is merged into `main` (after sign-off).

## D. Nginx configuration — read-only; no change required

```bash
nginx -T 2>/dev/null | grep -nE "server_name api\.bulkimart\.in|client_max_body_size|proxy_(read|send)_timeout|location .*media"
```
Purpose: confirm upload limits and that nothing maps `/media` on disk. Expected: `client_max_body_size 64M`; `proxy_read_timeout 900` and `proxy_send_timeout 900`; **no** `location … media` line (Node serves `/media` with its own access checks).

```bash
ls /home/bulkimartapi/htdocs/api.bulkimart.in/media 2>&1 | head -1
```
Expected: `No such file or directory` — so `/media/*` requests reach Node rather than a static folder.

No Nginx edit or reload is needed for this migration.

## E. Test execution — no production change (tests use temp dirs and an in-memory MongoDB)

```bash
cd /root/bulkimart/backend && npm test -- __tests__/services/media-storage.test.js __tests__/services/media-routing.test.js __tests__/services/cloudinary-upload.test.js __tests__/api/media-delivery.http.test.js 2>&1 | tail -60
```
Purpose: the storage test suites (validation, MIME/signature checks, re-encoding, SVG, video, signed URLs and expiry, ownership, cross-user access, KYC audit, legacy URL mapping, failure behaviour, disk-full, migration idempotency). The HTTP suite downloads a MongoDB test binary on first run (needs internet, ~1–2 min). Expected: `Tests: N passed, N total`, 0 failed. **Any failure: stop and send the output.**

```bash
cd /root/bulkimart/backend && npm test 2>&1 | tail -40
```
Purpose: full existing backend suite (regressions in other upload paths). Expected: same pass/fail counts as on `main`; to compare, run the same command after `git checkout main` and back. Send both summaries.

## F. Storage configuration — changes `backend/.env` (takes effect at G1)

```bash
cd /root/bulkimart/backend && cp .env /root/bulkimart-env-backup-$(date +%Y%m%d-%H%M%S) && ls -l /root/bulkimart-env-backup-*
```
Purpose: restorable copy of `.env`. Expected: a new backup file listed.

```bash
cd /root/bulkimart/backend
grep -qE '^MEDIA_SIGNING_SECRET=' .env || printf 'MEDIA_SIGNING_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
for line in MEDIA_ROOT=/var/lib/bulkimart/media MEDIA_PUBLIC_BASE_URL=https://api.bulkimart.in MEDIA_MIN_FREE_BYTES=5368709120 MEDIA_PROVIDER_DEFAULT=cloudinary EBOOK_STORAGE_DIR=/var/lib/bulkimart/ebooks SERVICE_STORAGE_DIR=/var/lib/bulkimart/services; do
  grep -qE "^${line%%=*}=" .env || printf '%s\n' "$line" >> .env
done
grep -oE '^(MEDIA_[A-Z_]+|EBOOK_STORAGE_DIR|SERVICE_STORAGE_DIR)=' .env | sort | uniq -c
```
Purpose: add the exact variables the code reads (`backend/config/storage.js`, e-book and service stores); the secret is generated straight into the file and never printed; existing values are not overwritten. **Every category stays on Cloudinary** (`MEDIA_PROVIDER_DEFAULT=cloudinary`, no `MEDIA_PROVIDERS`). Expected: each of the 7 names listed exactly once (`1 MEDIA_ROOT=` …).

## G. PM2 restart and health verification — **production restart (brief API reconnect)**

```bash
pm2 restart bulkimart-api --update-env && sleep 5 && pm2 ls
```
Expected: `bulkimart-api` online, restart count +1, not errored.

```bash
pm2 logs bulkimart-api --lines 60 --nostream 2>&1 | grep -iE "error|media|refus|MEDIA_" || echo "OK: no media errors in recent logs"
```
Expected: `OK…` or only unrelated lines. If it shows `MEDIA_ROOT`/`MEDIA_SIGNING_SECRET`/`MEDIA_PUBLIC_BASE_URL` errors, go to K1.

```bash
curl -s -o /dev/null -w 'health %{http_code} (expect 200)\n' https://api.bulkimart.in/api/health
curl -s -o /dev/null -w 'unknown public media %{http_code} (expect 404)\n' https://api.bulkimart.in/media/products/2026/11/00000000-0000-4000-8000-000000000000.webp
curl -s -o /dev/null -w 'forged private link %{http_code} (expect 403)\n' 'https://api.bulkimart.in/media/s/aaaaaaaaaaaaaaaaaaaaaaaa?e=9999999999&v=aaaaaaaaaaaaaaaaaaaaaaaa&s=forged'
curl -s -o /dev/null -w 'private dir via public route %{http_code} (expect 404)\n' https://api.bulkimart.in/media/seller-documents/2026/11/00000000-0000-4000-8000-000000000000.pdf
curl -s -o /dev/null -w 'direct media without login %{http_code} (expect 401)\n' https://api.bulkimart.in/api/media/aaaaaaaaaaaaaaaaaaaaaaaa
```
Purpose: new routes live and refusing what they must. Expected codes as shown.

```bash
cd /root/bulkimart/backend && DB=$(node --input-type=module -e "await import('/root/bulkimart/backend/config/environment.js'); const { default: m } = await import('mongoose'); await m.connect(process.env.MONGO_URI); console.log(m.connection.name); await m.disconnect();") && echo "database: $DB" && node scripts/media/migrate.mjs health --database="$DB"
```
Purpose: database name (no connection string printed) and storage health. Expected: `database: …`; JSON with `"configured":true,"writable":true`, `"defaultProvider":"cloudinary"`.

Manual check (production, still Cloudinary): upload one product image (seller web), one return photo (customer app) and open one seller KYC document in admin. Expected: all work exactly as before; image URLs still `res.cloudinary.com`.

## H. Five migration waves — each **changes production upload storage**; get approval before each wave

Run this once per shell session (defines a helper; no change by itself):
```bash
cd /root/bulkimart/backend && set_media_providers() { cp .env /root/bulkimart-env-backup-$(date +%Y%m%d-%H%M%S); sed -i '/^MEDIA_PROVIDERS=/d' .env; printf 'MEDIA_PROVIDERS=%s\n' "$1" >> .env; pm2 restart bulkimart-api --update-env && sleep 5 && pm2 ls && grep -E '^MEDIA_PROVIDERS=' .env; }
```

**Wave 1 — identity & bank documents**
```bash
set_media_providers '{"seller.kyc":"server","seller.bank":"server","delivery.kyc":"server","delivery.bank":"server"}'
```
Verify: seller onboarding steps 2–4 (web and Android) and rider steps 1–3 (web) upload; admin seller and rider dossiers open the new documents; the same document link opened in a private browser window after 15 min returns 403. Then:
```bash
ls -R /var/lib/bulkimart/media/private | tail -5 && node scripts/media/migrate.mjs health --database="$DB"
```
Expected: new files under `private/seller-documents/…` etc.; `media` counts for `seller.kyc`.

**Wave 2 — private personal data** (keeps wave 1)
```bash
set_media_providers '{"seller.kyc":"server","seller.bank":"server","delivery.kyc":"server","delivery.bank":"server","customer.landmark":"server","customer.return":"server","shared.ticket":"server"}'
```
Verify: landmark photo on address and checkout (web and Android); rider sees the landmark on an assigned order; return with photo + PDF; support ticket with attachment from customer, seller and rider; admin reply with attachment.

**Wave 3 — catalogue**
```bash
set_media_providers '{"seller.kyc":"server","seller.bank":"server","delivery.kyc":"server","delivery.bank":"server","customer.landmark":"server","customer.return":"server","shared.ticket":"server","seller.product":"server","customer.review":"server","seller.branding":"server","customer.avatar":"server"}'
```
Verify: create and edit a product with 5 images (web and Android), bulk upload, review photos, store logo/banner, profile photo; image search finds the new product within a few minutes.

**Wave 4 — admin / CMS**
```bash
set_media_providers '{"seller.kyc":"server","seller.bank":"server","delivery.kyc":"server","delivery.bank":"server","customer.landmark":"server","customer.return":"server","shared.ticket":"server","seller.product":"server","customer.review":"server","seller.branding":"server","customer.avatar":"server","admin.banner":"server","admin.category":"server","admin.campaign":"server","admin.broadcast":"server","admin.packaging":"server"}'
```
Verify: banner create/edit; category image and an SVG icon (renders as PNG); campaign banner; push broadcast with image shows the image on an Android phone.

**Wave 5 — Storefront Studio images and videos**
```bash
set_media_providers '{"seller.kyc":"server","seller.bank":"server","delivery.kyc":"server","delivery.bank":"server","customer.landmark":"server","customer.return":"server","shared.ticket":"server","seller.product":"server","customer.review":"server","seller.branding":"server","customer.avatar":"server","admin.banner":"server","admin.category":"server","admin.campaign":"server","admin.broadcast":"server","admin.packaging":"server","admin.storefront":"server"}'
```
Verify: Studio image upload; MP4 (H.264, ≤ 15 s, ≤ 1280 px) uploads and a WebM/long clip is refused with a clear message; draft → publish → rollback → schedule unchanged; video plays and seeks on desktop Chrome, iPhone Safari and Android.

After each wave:
```bash
pm2 logs bulkimart-api --lines 100 --nostream 2>&1 | grep -iE "MEDIA|error" | tail -20; df -h /
```
Expected: no `[MEDIA]` errors; disk use roughly unchanged.

## I. Cloudinary asset migration — copies files and adds `media` records; Cloudinary untouched

`$DB` and `set_media_providers` exist only in the shell where they were defined. In a new shell, re-run the `DB=$(…)` command from G and the helper line from H first.

```bash
cd /root/bulkimart/backend && node scripts/media/migrate.mjs inventory --database="$DB" --out=/var/lib/bulkimart/reports/inventory-$(date +%Y%m%d-%H%M).json
```
Purpose: list every Cloudinary URL in the database (read-only on the DB). Expected: JSON with `uniqueAssets`, `references`, `byCategory`. **Send this output** — it sizes the copy (compare total with `df -h /`).

For each category in this order — `seller.kyc seller.bank delivery.kyc delivery.bank customer.landmark customer.return shared.ticket seller.product customer.review seller.branding customer.avatar admin.banner admin.category admin.campaign admin.broadcast admin.packaging admin.storefront` — run (example shown for `seller.kyc`; repeat with each name):
```bash
node scripts/media/migrate.mjs copy --database="$DB" --category=seller.kyc --limit=20
node scripts/media/migrate.mjs copy --database="$DB" --category=seller.kyc --limit=20 --apply
node scripts/media/migrate.mjs copy --database="$DB" --category=seller.kyc --limit=200 --apply
```
Purpose: dry-run count, a small first batch, then larger batches until `"pendingAfter":0`. Expected: `verified` counts rise; `failed` items listed with a reason (they keep their Cloudinary URL; re-running retries them); `quarantined` items are kept but never served.

```bash
node scripts/media/migrate.mjs verify --database="$DB" --limit=5000
```
Expected: `"failures":[]`.

Turn on read-time mapping (historical orders/returns display the server copy; records unchanged) — **production change**:
```bash
grep -q '^MEDIA_LEGACY_READ_MAP=' .env && sed -i 's/^MEDIA_LEGACY_READ_MAP=.*/MEDIA_LEGACY_READ_MAP=on/' .env || printf 'MEDIA_LEGACY_READ_MAP=on\n' >> .env; pm2 restart bulkimart-api --update-env && sleep 5 && pm2 ls
```

Optional, only after 7 clean days: rewrite live catalogue/profile fields (never orders/returns/tickets/notifications), logged for rollback — **production data change**:
```bash
node scripts/media/migrate.mjs cutover --database="$DB"
node scripts/media/migrate.mjs cutover --database="$DB" --collection=products --apply
```
Expected: dry-run `eligible` count, then `updated` equal to it (minus any changed since).

## J. Production verification — these are production tests (no staging exists)

```bash
pm2 restart bulkimart-api --update-env && sleep 5 && ls /var/lib/bulkimart/media/public | head && node scripts/media/migrate.mjs health --database="$DB"
```
Purpose: media survives a PM2 restart. Expected: same directories and counts as before the restart.

```bash
find /var/lib/bulkimart/media -type f | wc -l > /root/media-count-before.txt && cat /root/media-count-before.txt
```
Run before the next frontend deployment; after it, run `find /var/lib/bulkimart/media -type f | wc -l`. Expected: same or higher count (deployment never deletes media).

```bash
F=$(find /var/lib/bulkimart/media/private -type f -name '*.*' | head -1); [ -n "$F" ] && curl -s -o /dev/null -w 'private file via public URL %{http_code} (expect 404)\n' "https://api.bulkimart.in/media/${F#/var/lib/bulkimart/media/private/}"
```
Purpose: a real private file cannot be fetched without a signed link. Expected: `404`.

Manual matrix (record in [STORAGE_WORKFLOW_CHECKLIST.md](STORAGE_WORKFLOW_CHECKLIST.md) per app): customer web, customer Android, seller web, seller Android, delivery portal, admin — upload and display for each workflow in its wave; old orders and returns still show images; an unpaid customer cannot download an e-book.

## K. Rollback

**K1 — API won't start after F/G:** restore the `.env` backup and restart (**production change**):
```bash
cd /root/bulkimart/backend && cp "$(ls -t /root/bulkimart-env-backup-* | head -1)" .env && pm2 restart bulkimart-api --update-env && sleep 5 && pm2 ls
```

**K2 — a wave misbehaves:** re-run the previous wave's `set_media_providers` command from H (or `set_media_providers '{}'` for none). New uploads go back to Cloudinary; files already on the server stay readable. For wave 1 categories this sends new KYC documents to public Cloudinary URLs again — owner approval required.

**K3 — turn off read-time mapping:**
```bash
cd /root/bulkimart/backend && sed -i 's/^MEDIA_LEGACY_READ_MAP=.*/MEDIA_LEGACY_READ_MAP=off/' .env && pm2 restart bulkimart-api --update-env
```

**K4 — undo a cutover:**
```bash
node scripts/media/migrate.mjs rollback --database="$DB"
node scripts/media/migrate.mjs rollback --database="$DB" --apply
```

**K5 — return to the previous code** (only if the branch itself is faulty; server-stored files then stop being served until you return):
```bash
cd /root/bulkimart && git checkout main && pm2 restart bulkimart-api --update-env
```

## L. Client-launch backup configuration — mandatory before launch

```bash
rclone config
```
Purpose: interactive setup. Create a remote named exactly `bulkimart-backup` pointing at storage **outside this VPS** (another server over SFTP, or a storage account), then a `crypt` remote named exactly `bulkimart-backup-crypt` wrapping `bulkimart-backup:bulkimart`. Store the crypt passwords somewhere other than this server.

```bash
rclone sync /var/lib/bulkimart bulkimart-backup-crypt:current --exclude "media/temp/**" --backup-dir bulkimart-backup-crypt:deleted/$(date +%Y%m%d) --log-level INFO && rclone size bulkimart-backup-crypt:current
```
Purpose: first full encrypted backup. Expected: size close to `du -sh /var/lib/bulkimart`.

```bash
printf '%s\n' '30 2 * * * root rclone sync /var/lib/bulkimart bulkimart-backup-crypt:current --exclude "media/temp/**" --backup-dir bulkimart-backup-crypt:deleted/$(date +\%Y\%m\%d) --log-file /var/log/bulkimart-media-backup.log --log-level INFO' > /etc/cron.d/bulkimart-media-backup && chmod 644 /etc/cron.d/bulkimart-media-backup && cat /etc/cron.d/bulkimart-media-backup
```
Purpose: nightly backup at 02:30. Expected: the cron line printed.

```bash
mkdir -p /root/restore-test && rclone copy bulkimart-backup-crypt:current/media/private /root/restore-test/private && diff -rq /var/lib/bulkimart/media/private /root/restore-test/private && echo "RESTORE TEST PASSED" ; rm -rf /root/restore-test
```
Purpose: non-destructive restore test into a scratch folder. Expected: `RESTORE TEST PASSED`. Record the date in [STORAGE_BACKUP_RESTORE_RUNBOOK.md](STORAGE_BACKUP_RESTORE_RUNBOOK.md).

Also enable automatic VPS backups/snapshots in the Hostinger panel, and confirm the hosted MongoDB backup schedule.
