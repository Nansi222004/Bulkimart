# Cloudinary Migration Results

Status: **No migration has been run.** This file records actual command output from the server; nothing here is a projection. Commands are in [STORAGE_DEPLOYMENT_RUNBOOK.md](STORAGE_DEPLOYMENT_RUNBOOK.md) §7.

## Inventory

| Date | Database | Unique assets | References | Unclassified | Manifest path |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

Per-category counts (paste the `byCategory` JSON from `migrate.mjs inventory`):

```
(not run)
```

## Copy batches

| Date | Category | Batch | Verified | Quarantined | Failed | Pending after | Notes |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — |

## Verification runs (`migrate.mjs verify`)

| Date | Checked | Failures |
|---|---|---|
| — | — | — |

## Quarantined / failed assets

Each needs a decision (re-upload by owner, accept loss, or leave on Cloudinary). List the URL's category and record, never the document content.

| Legacy URL (truncated) | Category | Reason | Decision |
|---|---|---|---|

## Read-time map and cutover

| Date | Action | Result |
|---|---|---|
| — | `MEDIA_LEGACY_READ_MAP=on` | not done |
| — | cutover (per collection) | not done |

## Cloudinary cleanup

Not approved. Requires the conditions in [CLOUDINARY_MIGRATION_PLAN.md](CLOUDINARY_MIGRATION_PLAN.md) §7 and written owner approval in [STORAGE_PRODUCTION_SIGNOFF.md](STORAGE_PRODUCTION_SIGNOFF.md).
