# Storage Rollback Runbook

For: the server operator. Exact commands are in [STORAGE_FINAL_SERVER_COMMANDS.md](STORAGE_FINAL_SERVER_COMMANDS.md) §K; this page explains when to use each one.

## Rules that hold for every rollback

1. **Identity and bank documents never go back to Cloudinary.** `seller.kyc`, `seller.bank`, `delivery.kyc` and `delivery.bank` accept only `server` or `disabled`. The code enforces this: an explicit `"cloudinary"` for them stops the API at startup, and once `MEDIA_KYC_LOCK=on` (set in wave 1, never removed) any setting that would resolve to Cloudinary means "paused".
2. **Server-stored media is never deleted during a rollback.** No step removes files under `/var/lib/bulkimart` or records in `media`, `mediaaccessaudits` or `mediamigrationlogs`.
3. **Reading server media keeps working.** Rollbacks change only where *new* uploads go. `MEDIA_ROOT`, `MEDIA_SIGNING_SECRET`, `MEDIA_PUBLIC_BASE_URL`, `EBOOK_STORAGE_DIR` and `SERVICE_STORAGE_DIR` stay set, and the API stays on the `storage/server-media` code.
4. **Do not return to `main` after wave 1.** `main` cannot read `media:<id>` references or `/media/` URLs. Once any file has been stored on the server, checking out `main` would make KYC documents, landmark photos and return/ticket attachments unreadable. It is safe only before wave 1.
5. Back up `.env` before every edit (the `set_media_providers` helper does this automatically).

## Situations

| Situation | Action | Commands |
|---|---|---|
| API does not start after a `.env` change | Read the failing setting name from the log (values are never printed), fix it; or restore the latest `.env` backup taken **after** section F | §K1 |
| One category misbehaves (any category, including KYC) | **Pause it:** set it to `"disabled"`. Uploads of that type return "temporarily paused"; everything stored stays readable | §K2 |
| A non-sensitive category should use Cloudinary again for new uploads | Set it to `"cloudinary"`. Not allowed for the four identity/bank categories | §K3 |
| Historical images look wrong after `MEDIA_LEGACY_READ_MAP=on` | Turn the map off; responses show the original Cloudinary URLs again (originals are untouched) | §K4 |
| A cutover rewrote live fields incorrectly | Undo from `mediamigrationlogs`; fields changed by users since are reported (`changedSince`) and left alone; log entries are kept | §K5 |
| The storage code itself is faulty | Pause affected categories, then fix forward on `storage/server-media` or check out an earlier commit **of that branch** — never `main` after wave 1 | §K6 |
| An asset migration batch misbehaves | Stop it (Ctrl-C). Interrupted copies stay `copying`/`failed` and are resumed or retried by the next run without duplicates; temp files are swept after 24 h | §I copy loop |
| Disk filling up | Uploads are refused automatically below `MEDIA_MIN_FREE_BYTES` (507). Pause migration batches; do not delete media to make room | — |

## After any rollback

- Check: product listing images, an order history page with images, a return with attachments, and an admin seller dossier (documents open for the admin, not for another user).
- `pm2 logs bulkimart-api --lines 100 --nostream 2>&1 | grep MEDIA`
- Record what changed, when and why in [STORAGE_IMPLEMENTATION_REPORT.md](STORAGE_IMPLEMENTATION_REPORT.md).
