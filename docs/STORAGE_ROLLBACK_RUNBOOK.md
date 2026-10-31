# Storage Rollback Runbook

For: the server operator. Principles: never delete or overwrite media during rollback; keep server files, `media` records and `mediamigrationlogs` for investigation; never route identity/bank documents back to public Cloudinary without explicit owner approval.

All commands run in `/root/bulkimart/backend`. Back up `.env` before editing: `cp .env /root/bulkimart-env-backup-$(date +%Y%m%d-%H%M%S)`.

## 1. API fails to start after deploying the branch

Symptoms: `pm2 ls` shows errored/restarting; logs mention `MEDIA_ROOT`, `MEDIA_SIGNING_SECRET` or `MEDIA_PUBLIC_BASE_URL`.

1. Fix the named setting (startup refuses unsafe storage config by design), then `pm2 restart bulkimart-api --update-env`.
2. If it must be back up immediately: set `MEDIA_PROVIDER_DEFAULT=cloudinary`, remove `MEDIA_PROVIDERS` and `MEDIA_LEGACY_READ_MAP`, restart. The storage check is then skipped.
3. Last resort: `git checkout main && pm2 restart bulkimart-api --update-env`. **Effect:** files already uploaded to the server stop being served (records keep `media:` references / server URLs that `main` cannot resolve). Use only briefly; return to the branch to restore access.

## 2. A category misbehaves after switching uploads to the server

Remove that category from `MEDIA_PROVIDERS` (or set it to `"cloudinary"`) and restart:

```bash
grep '^MEDIA_PROVIDERS=' .env            # current map
# edit the JSON, then:
pm2 restart bulkimart-api --update-env
```

New uploads for that category go to Cloudinary again; everything already stored on the server stays readable because reading never depends on the provider flag.

**Exception — identity/bank categories (`seller.kyc`, `seller.bank`, `delivery.kyc`, `delivery.bank`):** switching them back sends new KYC documents to public Cloudinary URLs (security finding F1). Do this only with the backend owner's explicit approval; the preferred action is to fix forward or to pause onboarding.

## 3. Stop an asset migration

Asset copying only runs while `migrate.mjs copy` is running — stop it with Ctrl-C. Partial temp files are swept automatically after 24 h. Re-running resumes; verified items are skipped.

## 4. Turn off read-time legacy mapping

```bash
sed -i 's/^MEDIA_LEGACY_READ_MAP=on/MEDIA_LEGACY_READ_MAP=off/' .env && pm2 restart bulkimart-api --update-env
```

Responses return the original Cloudinary URLs again (Cloudinary originals are untouched).

## 5. Undo a cutover

```bash
node scripts/media/migrate.mjs rollback --database=<DB_NAME>                         # counts only
node scripts/media/migrate.mjs rollback --database=<DB_NAME> --collection=products --apply
```

Restores each field's original Cloudinary URL where the field still holds the value the cutover wrote; fields changed since by users are reported as `changedSince` and left alone.

## 6. After any rollback

- Verify: product listing images, an order history page with images, a return with attachments, admin seller dossier documents.
- Check `pm2 logs bulkimart-api --lines 100 --nostream | grep MEDIA`.
- Record what was rolled back, when and why in [STORAGE_IMPLEMENTATION_REPORT.md](STORAGE_IMPLEMENTATION_REPORT.md).
