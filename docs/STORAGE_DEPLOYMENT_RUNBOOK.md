# Storage Deployment Runbook

For: whoever operates `srv2104110` (Hostinger VPS, Ubuntu 24.04, PM2 `bulkimart-api`, repo `/root/bulkimart`).

**The exact, placeholder-free command sequence is [STORAGE_FINAL_SERVER_COMMANDS.md](STORAGE_FINAL_SERVER_COMMANDS.md); it supersedes the command blocks below where they differ.** This runbook keeps the reasoning and the development-machine step §0.
Run as root from the server. Every step is safe to stop after; nothing deletes Cloudinary assets.

**Launch blocker:** server-stored media has **no independent backup** until [STORAGE_BACKUP_RESTORE_RUNBOOK.md](STORAGE_BACKUP_RESTORE_RUNBOOK.md) is completed and a restore is tested. Cloudinary originals are the only second copy of migrated assets; files uploaded after cutover exist only on this disk.

## 0. Get the code onto the server

The code is on branch `storage/server-media` (see the implementation report for the file list). On the development machine, after review:

```bash
git switch -c storage/server-media
git add backend/config/storage.js backend/models/Media.js backend/models/MediaAccessAudit.js \
  backend/services/media.service.js backend/services/mediaPolicy.service.js backend/services/mediaValidation.service.js \
  backend/services/mediaStorage.service.js backend/services/mediaUrl.service.js backend/services/mediaCleanup.service.js \
  backend/services/mediaMigration.service.js backend/services/cloudinary.service.js backend/services/productUploadCleanup.service.js \
  backend/services/imageSearchIndexer.service.js backend/middlewares/mediaResponse.middleware.js backend/middlewares/auth.middleware.js \
  backend/routes/media.routes.js backend/routes/index.js backend/routes/storefront.routes.js backend/index.js \
  backend/scripts/media/migrate.mjs backend/__tests__/services/media-storage.test.js backend/__tests__/services/media-routing.test.js \
  backend/__tests__/services/cloudinary-upload.test.js backend/__tests__/api/media-delivery.http.test.js \
  backend/controllers/{admin,broadcast,bulkProduct,campaign,category,deliveryPartner,packaging,product,return,seller,ticket,user}.controller.js \
  docs/PLATFORM_STORAGE_AUDIT.md docs/CENTRAL_STORAGE_ARCHITECTURE.md docs/STORAGE_API_SPECIFICATION.md docs/STORAGE_SECURITY_REPORT.md \
  docs/CLOUDINARY_MIGRATION_PLAN.md docs/STORAGE_MIGRATION_TEST_PLAN.md docs/STORAGE_INFRASTRUCTURE_REQUIREMENTS.md \
  docs/STORAGE_WORKFLOW_CHECKLIST.md docs/STORAGE_IMPLEMENTATION_REPORT.md docs/STORAGE_DEPLOYMENT_RUNBOOK.md \
  docs/STORAGE_ROLLBACK_RUNBOOK.md docs/STORAGE_BACKUP_RESTORE_RUNBOOK.md docs/CLOUDINARY_MIGRATION_RESULTS.md docs/STORAGE_PRODUCTION_SIGNOFF.md \
  docs/STORAGE_FINAL_SERVER_COMMANDS.md
git commit -m "Server media storage: central service, private media, Cloudinary migration tooling"
git push -u origin storage/server-media
```

The working tree contains other people's uncommitted changes (`mobile-user/…`); the explicit file list keeps them out of this commit.

## 1. Pre-flight (read-only)

```bash
cd /root/bulkimart
df -h / && df -i /                      # expect plenty free (183 GB at last check)
git status --short                      # only " M deploy.sh" expected
pm2 ls                                  # bulkimart-api online
curl -s -o /dev/null -w '%{http_code}\n' https://api.bulkimart.in/api/health   # 200
```

## 2. Create the storage directories (approved location)

```bash
mkdir -p /var/lib/bulkimart/media/{public,private,temp,quarantine} /var/lib/bulkimart/ebooks /var/lib/bulkimart/services /var/lib/bulkimart/reports
chmod 750 /var/lib/bulkimart /var/lib/bulkimart/media /var/lib/bulkimart/media/public
chmod 700 /var/lib/bulkimart/media/{private,temp,quarantine} /var/lib/bulkimart/ebooks /var/lib/bulkimart/services /var/lib/bulkimart/reports
ls -la /var/lib/bulkimart /var/lib/bulkimart/media
```

The Node process runs as root, so it can write here. Nginx does not need access (Node serves `/media`). No deploy script references `/var/lib/bulkimart`; verify with:

```bash
grep -n "var/lib/bulkimart" /root/bulkimart/deploy.sh || echo "deploy.sh does not touch the media directory"
```

## 3. Check out and test the branch (no restart yet)

```bash
cd /root/bulkimart
git fetch origin storage/server-media
git checkout storage/server-media        # keeps the local deploy.sh change
git log -1 --oneline
cd backend
npm test -- __tests__/services/media-storage.test.js __tests__/services/media-routing.test.js __tests__/services/cloudinary-upload.test.js __tests__/api/media-delivery.http.test.js 2>&1 | tail -60
```

No new npm packages are required (uses existing `sharp`, `multer`, `mongoose`, `express-rate-limit`). Paste the test output into the implementation report. **Stop here if anything fails.**

## 4. Configure (values are written straight into .env, never printed)

```bash
cd /root/bulkimart/backend
cp .env /root/bulkimart-env-backup-$(date +%Y%m%d-%H%M%S)
grep -qE '^MEDIA_SIGNING_SECRET=' .env || printf 'MEDIA_SIGNING_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
cat >> .env <<'EOF'
MEDIA_ROOT=/var/lib/bulkimart/media
MEDIA_PUBLIC_BASE_URL=https://api.bulkimart.in
MEDIA_MIN_FREE_BYTES=5368709120
MEDIA_PROVIDER_DEFAULT=cloudinary
EBOOK_STORAGE_DIR=/var/lib/bulkimart/ebooks
SERVICE_STORAGE_DIR=/var/lib/bulkimart/services
EOF
grep -oE '^(MEDIA_[A-Z_]+|EBOOK_STORAGE_DIR|SERVICE_STORAGE_DIR)=' .env | sort | uniq -c   # each name exactly once
```

`MEDIA_PROVIDER_DEFAULT=cloudinary` means this deploy changes **no upload behaviour** yet; it only adds the media routes, private-reference handling and the startup checks. E-book and service documents start using `/var/lib/bulkimart/...` (they had no uploads yet — see infrastructure report).

## 5. Restart and verify

```bash
pm2 restart bulkimart-api --update-env && sleep 4 && pm2 ls
pm2 logs bulkimart-api --lines 40 --nostream | grep -iE "media|error|refuses" || true
curl -s -o /dev/null -w 'health %{http_code}\n' https://api.bulkimart.in/api/health
curl -s -o /dev/null -w 'unknown media %{http_code} (expect 404)\n' https://api.bulkimart.in/media/products/2026/11/00000000-0000-4000-8000-000000000000.webp
curl -s -o /dev/null -w 'bad signature %{http_code} (expect 403)\n' "https://api.bulkimart.in/media/s/aaaaaaaaaaaaaaaaaaaaaaaa?e=1&v=aaaaaaaaaaaaaaaaaaaaaaaa&s=x"
cd /root/bulkimart/backend && node scripts/media/migrate.mjs health --database=<DB_NAME>
```

To find `<DB_NAME>` without printing the connection string:

```bash
cd /root/bulkimart/backend && node --input-type=module -e "import './config/environment.js'; import m from 'mongoose'; await m.connect(process.env.MONGO_URI); console.log(m.connection.name); await m.disconnect();"
```

If the API does not come back: see [STORAGE_ROLLBACK_RUNBOOK.md](STORAGE_ROLLBACK_RUNBOOK.md) §1.

## 6. Switch new uploads to server storage, in waves

Each wave: edit one line, restart, run that wave's manual checks (test plan §3–4), record results in the checklist. Rollback for a wave = set its categories to `"disabled"` (pause) or, for non-sensitive categories only, `"cloudinary"` — never remove identity/bank categories or route them to Cloudinary; see [STORAGE_ROLLBACK_RUNBOOK.md](STORAGE_ROLLBACK_RUNBOOK.md). Wave 1 also sets `MEDIA_KYC_LOCK=on` permanently.

```bash
cd /root/bulkimart/backend
set_providers() { sed -i '/^MEDIA_PROVIDERS=/d' .env; printf "MEDIA_PROVIDERS=%s\n" "$1" >> .env; pm2 restart bulkimart-api --update-env; }
```

| Wave | Command | Check in the apps |
|---|---|---|
| 1 — KYC/bank | `set_providers '{"seller.kyc":"server","seller.bank":"server","delivery.kyc":"server","delivery.bank":"server"}'` | Seller onboarding steps 2–4 (web + Android), rider steps 1–3 (web), admin seller & rider dossiers open documents; a non-admin cannot open them |
| 2 — private PII | add `"customer.landmark":"server","customer.return":"server","shared.ticket":"server"` | Landmark photo on address + checkout (web + Android), rider sees landmark on assigned order, return with photos + PDF, tickets for customer/seller/rider + admin reply |
| 3 — catalogue | add `"seller.product":"server","customer.review":"server","seller.branding":"server","customer.avatar":"server"` | Create/edit product with 5 images (web + Android), bulk upload, review photos, store logo/banner, avatars; image search finds a new product |
| 4 — admin/CMS | add `"admin.banner":"server","admin.category":"server","admin.campaign":"server","admin.broadcast":"server","admin.packaging":"server"` | Banner create/edit, category image + SVG icon, campaign banner, push broadcast with image arrives on a phone |
| 5 — storefront | add `"admin.storefront":"server"` | Studio image + MP4 upload, draft/publish/rollback/schedule, video plays and seeks on desktop Chrome, iOS Safari, Android |

After wave 5 you may replace the map with `MEDIA_PROVIDER_DEFAULT=server` and an empty `MEDIA_PROVIDERS`.

## 7. Migrate existing Cloudinary assets (separate from step 6)

```bash
cd /root/bulkimart/backend
DB=<DB_NAME>
node scripts/media/migrate.mjs inventory --database=$DB --out=/var/lib/bulkimart/reports/inventory-$(date +%Y%m%d).json
# per category, smallest first; dry-run, then a small batch, then larger batches
node scripts/media/migrate.mjs copy --database=$DB --category=seller.kyc --limit=20
node scripts/media/migrate.mjs copy --database=$DB --category=seller.kyc --limit=20 --apply
node scripts/media/migrate.mjs verify --database=$DB
```

Use the cursor loop in [STORAGE_FINAL_SERVER_COMMANDS.md](STORAGE_FINAL_SERVER_COMMANDS.md) §I to walk each category until `nextAfter` is `null` (order: `seller.kyc`, `seller.bank`, `delivery.kyc`, `delivery.bank`, `customer.landmark`, `customer.return`, `shared.ticket`, then public categories). Run `migrate.mjs indexes --apply` once beforehand (§F); `copy --apply` refuses to run without the unique `legacy.url` index. Failed items stay on their Cloudinary URL, stay pending and are retried by the next loop (at most 3 attempts each; `--retry-failed` forces another). Check disk after each category: `df -h /`.

Then serve migrated copies at read time (historical orders/returns included, records untouched):

```bash
printf 'MEDIA_LEGACY_READ_MAP=on\n' >> .env && pm2 restart bulkimart-api --update-env
```

Optional, after 7 days of clean dual read — rewrite live (non-historical) fields to the new references, logged for rollback:

```bash
node scripts/media/migrate.mjs cutover --database=$DB                 # dry-run counts
node scripts/media/migrate.mjs cutover --database=$DB --collection=products --apply
```

Record every command's JSON output in [CLOUDINARY_MIGRATION_RESULTS.md](CLOUDINARY_MIGRATION_RESULTS.md).

## 8. Merge

After sign-off ([STORAGE_PRODUCTION_SIGNOFF.md](STORAGE_PRODUCTION_SIGNOFF.md)), merge `storage/server-media` into `main` so `deploy.sh` (which pulls `main`) keeps this code. Until then **do not run `deploy.sh`** — it would check out `main` and remove the media routes while `.env` still points uploads at the server.

## Nginx

No change required: `api.bulkimart.in` already proxies to Node with `client_max_body_size 64M` and 900 s proxy timeouts, which covers the 50 MB bulk ZIP and 15 MB videos. `/media/*` paths do not exist in the CloudPanel web root, so they reach Node. If you later want Nginx to serve public media directly, do it through CloudPanel's Vhost editor (alias to `/var/lib/bulkimart/media/public/`, never `private/`, `temp/` or `quarantine/`), back up the vhost first and run `nginx -t` before reload.
