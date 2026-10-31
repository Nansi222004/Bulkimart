# Storage — Final Server Commands

For: the operator of the Hostinger VPS `srv2104110` (Ubuntu 24.04, root, repo `/root/bulkimart`, PM2 `bulkimart-api`, API `https://api.bulkimart.in`).

Run sections **in order**. Each command lists its purpose, the expected result and whether it **changes production**. Stop at the first unexpected result and send the output back. Nothing here deletes Cloudinary assets, Cloudinary configuration or existing records.

> **Prerequisite:** branch `storage/server-media` is on GitHub (first commit `fd97f15`). The production-safety review fixes are a **second, not-yet-committed change** on the same branch; C1 must show the commit that contains `backend/__tests__/api/media-migration.http.test.js` (check with C2's file list) before you continue past section B.

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
cd /root/bulkimart/backend && npm test -- __tests__/services/media-storage.test.js __tests__/services/media-routing.test.js __tests__/services/cloudinary-upload.test.js __tests__/api/media-delivery.http.test.js __tests__/api/media-migration.http.test.js 2>&1 | tail -60
```
Purpose: the storage test suites (validation, MIME/signature checks, re-encoding, SVG, video, signed URLs and expiry, ownership, cross-user access, KYC audit, symlink rejection, legacy URL mapping, failure behaviour, disk-full, paused categories and the KYC lock, index migration, batch pagination over 250 assets, failed-asset retry, interrupted-copy recovery, quarantine, verification of all records, restored-backup verification). The HTTP suite downloads a MongoDB test binary on first run (needs internet, ~1–2 min). Expected: `Tests: N passed, N total`, 0 failed. **Any failure: stop and send the output.**

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
Purpose: add the exact variables the code reads (`backend/config/storage.js`, e-book and service stores); the secret is generated straight into the file and never printed; existing values are not overwritten. **Every category stays on Cloudinary** (`MEDIA_PROVIDER_DEFAULT=cloudinary`, no `MEDIA_PROVIDERS`). Expected: each of the 7 names listed exactly once (`1 MEDIA_ROOT=` …). Once `MEDIA_ROOT` is set the API refuses to start unless `EBOOK_STORAGE_DIR` and `SERVICE_STORAGE_DIR` are set outside the repository, so e-books and service documents can never fall back into `backend/private-data/`.

Media indexes. The `media` and `mediaaccessaudits` models do **not** build indexes on startup; they are created explicitly here. The command only **adds missing** indexes on these two new collections — it never drops or rebuilds an index (no `syncIndexes`).

```bash
cd /root/bulkimart/backend && DB=$(node --input-type=module -e "await import('/root/bulkimart/backend/config/environment.js'); const { default: m } = await import('mongoose'); await m.connect(process.env.MONGO_URI); console.log(m.connection.name); await m.disconnect();") && echo "database: $DB" && node scripts/media/migrate.mjs indexes --database="$DB"
```
Dry-run, read-only. Expected: `database: …`, then for `media` and `mediaaccessaudits` the declared indexes and `missing` (all of them on first run), `created: []`.

```bash
node scripts/media/migrate.mjs indexes --database="$DB" --apply
```
**Production database change (additive):** creates the missing indexes on the two empty collections. Indexes: `media` — `storageKey` (unique, partial), `legacy.url` (unique, partial; required before any copy), `category`, `uploadStatus`, `{ownerId, category, sha256}`, `{uploadStatus, updatedAt}`, `{migrationStatus, _id}`; `mediaaccessaudits` — `mediaId`, `viewerId`. Expected: `created` lists them; running it again shows `missing: []`. `migrate.mjs copy --apply` refuses to run until the `legacy.url` index exists.

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
grep -q '^MEDIA_KYC_LOCK=' .env || printf 'MEDIA_KYC_LOCK=on\n' >> .env
set_media_providers '{"seller.kyc":"server","seller.bank":"server","delivery.kyc":"server","delivery.bank":"server"}'
```
`MEDIA_KYC_LOCK=on` is permanent from this point: identity and bank documents can never go to Cloudinary again — an explicit `"cloudinary"` is rejected at startup and an omitted key means "paused". Never remove this line.
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
Purpose: list every Cloudinary URL in the database (read-only on the DB). The manifest contains asset URLs (including KYC) and is written 0600 into the 0700 reports folder — do not copy it off the server unencrypted. Expected output (no URLs printed): `uniqueAssets` (distinct files) vs `references` (places they are used), `duplicateUrls`, `unclassified` (sample of hashed ids and field names), `otherCloudinaryAccounts`, `localFallbackUploadReferences`, and `byCategory` with `verified / quarantined / pending / failed / blocked`. **Send this output** — it sizes the copy (compare with `df -h /`). Unclassified and other-account assets are not copied; each needs a decision.

Copy one category at a time, in this order: `seller.kyc seller.bank delivery.kyc delivery.bank customer.landmark customer.return shared.ticket seller.product customer.review seller.branding customer.avatar admin.banner admin.category admin.campaign admin.broadcast admin.packaging admin.storefront`. Set the category once, then:

```bash
CAT=seller.kyc
node scripts/media/migrate.mjs copy --database="$DB" --category=$CAT --limit=20
```
Dry-run: `would-copy` / `would-retry` counts and `pendingAfter`; nothing written.

```bash
node scripts/media/migrate.mjs copy --database="$DB" --category=$CAT --limit=20 --apply
```
First small batch — **adds files and `media` records**. Expected: `verified` ≈ 20, `failures` listed by hashed id with a URL-free reason, `nextAfter` (cursor) and `pendingAfter`.

```bash
AFTER=""; while :; do OUT=$(node scripts/media/migrate.mjs copy --database="$DB" --category=$CAT --limit=200 --apply ${AFTER:+--after=$AFTER}); echo "$OUT"; AFTER=$(printf '%s' "$OUT" | jq -r '.nextAfter // empty'); [ -z "$AFTER" ] && break; done
```
Walks the whole category in batches of 200 using the cursor, so failed items never block later ones (`jq` is installed on the VPS). Expected: last line has `"nextAfter":null`. Re-run the same loop to retry failures: each asset is attempted at most 3 times, `after.blocked` counts assets that reached the limit, and adding `--retry-failed` to the loop command forces one more attempt. Failed assets keep their Cloudinary URL and stay `pending`; verified ones are skipped on every re-run.

```bash
node scripts/media/migrate.mjs verify --database="$DB"
```
Re-hashes **every** migrated file (all pages) and checks size, SHA-256 and content type. Expected: `"failureCount":0` and exit code 0. If failures are listed, run it again with `--apply` (marks them `failed`, so they stop being served and the next copy loop replaces them), then repeat the copy loop and `verify`.

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

```bash
cd /root/bulkimart/backend && node scripts/media/migrate.mjs verify --database="$DB" --scope=all
```
Purpose: integrity of every stored file (uploads and migrated copies). Expected: `"failureCount":0`.

Manual matrix (record in [STORAGE_WORKFLOW_CHECKLIST.md](STORAGE_WORKFLOW_CHECKLIST.md) per app): customer web, customer Android, seller web, seller Android, delivery portal, admin — upload and display for each workflow in its wave; old orders and returns still show images; an unpaid customer cannot download an e-book.

## K. Rollback

Rules: never route identity/bank documents back to Cloudinary (the code refuses it); never delete server-stored media or `media` / `mediamigrationlogs` / `mediaaccessaudits` records; keep the storage branch running so server files stay readable. Every K step keeps `MEDIA_ROOT`, `MEDIA_SIGNING_SECRET`, `MEDIA_PUBLIC_BASE_URL`, `EBOOK_STORAGE_DIR` and `SERVICE_STORAGE_DIR` in place.

**K1 — API won't start after a `.env` change** (**production change**). Show only the failing setting name, fix it, restart:
```bash
pm2 logs bulkimart-api --lines 40 --nostream 2>&1 | grep -oE "(MEDIA_[A-Z_]+|EBOOK_STORAGE_DIR|SERVICE_STORAGE_DIR)[^.]*\." | sort -u
```
If the cause is unclear, restore the most recent `.env` backup **taken after section F** (it still contains the storage settings) and restart:
```bash
cd /root/bulkimart/backend && ls -t /root/bulkimart-env-backup-* | head -3
cp "$(ls -t /root/bulkimart-env-backup-* | head -1)" .env && pm2 restart bulkimart-api --update-env && sleep 5 && pm2 ls
```

**K2 — pause uploads for one category** (no data exposure; existing files stay readable). Example: pause product images while keeping everything else as in wave 5:
```bash
set_media_providers '{"seller.kyc":"server","seller.bank":"server","delivery.kyc":"server","delivery.bank":"server","customer.landmark":"server","customer.return":"server","shared.ticket":"server","seller.product":"disabled","customer.review":"server","seller.branding":"server","customer.avatar":"server","admin.banner":"server","admin.category":"server","admin.campaign":"server","admin.broadcast":"server","admin.packaging":"server","admin.storefront":"server"}'
```
Uploads of that type return "temporarily paused" (503). To pause identity/bank uploads use `"disabled"` for those four keys: `"cloudinary"` is rejected at startup, and with `MEDIA_KYC_LOCK=on` an omitted identity/bank key is treated as paused too.

**K3 — send a non-sensitive category's new uploads back to Cloudinary:** set it to `"cloudinary"` the same way (allowed for every category except the four identity/bank ones). Files already stored on the server stay readable.

**K4 — turn off read-time mapping** (historical items show their Cloudinary URLs again):
```bash
cd /root/bulkimart/backend && sed -i 's/^MEDIA_LEGACY_READ_MAP=.*/MEDIA_LEGACY_READ_MAP=off/' .env && pm2 restart bulkimart-api --update-env
```

**K5 — undo a cutover** (restores original values where unchanged; log entries are kept):
```bash
node scripts/media/migrate.mjs rollback --database="$DB"
node scripts/media/migrate.mjs rollback --database="$DB" --apply
```

**K6 — the storage code itself is faulty.** Do **not** check out `main` once anything is stored on the server: `main` cannot read `media:` references or `/media/` URLs, so KYC documents, landmark photos, return and ticket files would become unreadable. Instead pause the affected categories (K2), then deploy a fix on `storage/server-media`, or return to an earlier commit of that same branch:
```bash
cd /root/bulkimart && git log --oneline -5 origin/storage/server-media
```
Pick the previous good commit from that list and check it out by its hash, then `pm2 restart bulkimart-api --update-env`. Returning to `main` is only safe before section H wave 1 has stored any file.

## L. Client-launch backup configuration — mandatory before launch

Full procedure, reasoning and restore steps: [STORAGE_BACKUP_RESTORE_RUNBOOK.md](STORAGE_BACKUP_RESTORE_RUNBOOK.md). The commands, in order:

```bash
rclone config
```
Interactive; **creates rclone configuration only**. Create remote `bulkimart-backup` pointing at storage **outside this VPS**, then a `crypt` remote named `bulkimart-backup-crypt` wrapping `bulkimart-backup:bulkimart`. Store the remote credentials and the crypt password and salt in the owner's password manager **off this server** — without them the backup cannot be decrypted after a server loss.

```bash
cd /var/lib/bulkimart && D=$(date +%Y%m%d-%H%M) && find media/public media/private ebooks services -type f -print0 | sort -z | xargs -0 -r sha256sum > reports/manifest-$D.sha256 && wc -l reports/manifest-$D.sha256
```
SHA-256 manifest of every file that is backed up (read-only on the files). Expected: one line per file.

```bash
rclone copy /var/lib/bulkimart bulkimart-backup-crypt:current --exclude "media/temp/**" --checksum --log-level INFO --stats-one-line && rclone size bulkimart-backup-crypt:current
```
First backup. Direction: **VPS (source) → remote (destination)**. `copy` only adds or updates files on the remote and **never deletes anything there**. Expected size close to `du -sh --exclude=media/temp /var/lib/bulkimart`.

MongoDB metadata (media, audit and migration records plus all business collections): runbook §3.

Scheduled nightly file backup (**creates a cron job**):
```bash
printf '%s\n' '30 2 * * * root rclone copy /var/lib/bulkimart bulkimart-backup-crypt:current --exclude "media/temp/**" --backup-dir bulkimart-backup-crypt:versions/$(date +\%Y\%m\%d) --log-file /var/log/bulkimart-media-backup.log --log-level INFO && date -u +\%FT\%TZ > /var/lib/bulkimart/reports/last-backup-ok' > /etc/cron.d/bulkimart-media-backup && chmod 644 /etc/cron.d/bulkimart-media-backup && cat /etc/cron.d/bulkimart-media-backup
```
`--backup-dir` keeps any file that would be overwritten under `versions/<date>/` (version retention). `copy` never removes files from the remote, so files deleted on the VPS stay in the backup until the retention step in the runbook prunes them. `rclone sync` is deliberately **not** used: it deletes remote files that no longer exist on the VPS.

Non-destructive restore test (scratch folder only; never over `/var/lib/bulkimart`):
```bash
rm -rf /root/restore-test && mkdir -p /root/restore-test && rclone copy bulkimart-backup-crypt:current /root/restore-test --checksum && cd /root/restore-test && sha256sum --quiet -c "$(ls -t /var/lib/bulkimart/reports/manifest-*.sha256 | head -1)" && echo "MANIFEST CHECK PASSED"
cd /root/bulkimart/backend && node scripts/media/migrate.mjs verify --database="$DB" --scope=all --root=/root/restore-test/media && echo "DATABASE CHECK PASSED"
rm -rf /root/restore-test
```
Expected: `MANIFEST CHECK PASSED` (every restored file matches its SHA-256) and `DATABASE CHECK PASSED` (every `media` record's file was restored with the right size, SHA-256 and type). Record the date in the backup runbook's log. Backups are **not** to be described as configured until both pass.

Also enable automatic VPS backups/snapshots in the Hostinger panel, and confirm the hosted MongoDB's backup schedule and retention.
