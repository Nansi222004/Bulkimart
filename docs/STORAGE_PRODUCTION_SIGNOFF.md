# Storage Production Sign-off

Each line is signed by a named person with a date and a link to evidence (test output, screenshots, command output). Unsigned = not approved.

## Gates

| # | Gate | Evidence | Signed by | Date |
|---|---|---|---|---|
| 1 | Storage location `/var/lib/bulkimart` approved | Owner instruction, 2026-11-01 brief | Owner (per brief) | 2026-11-01 |
| 2 | Automated storage tests pass on the server | runbook §3 output | | |
| 3 | Deploy with all categories on Cloudinary: API healthy, media routes 404/403 as expected | runbook §5 output | | |
| 4 | Wave 1 (KYC/bank) verified on seller web, seller Android, delivery web, admin | test plan §3–4 | | |
| 5 | Wave 2 (landmark, returns, tickets) verified on customer web, customer Android, seller, rider, admin | | | |
| 6 | Wave 3 (catalogue) verified incl. image search | | | |
| 7 | Wave 4 (admin/CMS) verified incl. push image on a phone | | | |
| 8 | Wave 5 (storefront) verified: draft/publish/rollback/schedule, video playback + seeking on 3 browsers | | | |
| 9 | Security matrix (test plan §4) executed | | | |
| 10 | Cloudinary inventory complete; all categories copied and verified | migration results | | |
| 11 | Read-time map on; historical orders/returns display | | | |
| 12 | **Backups configured and restore test passed (launch blocker)** | backup runbook log | | |
| 13 | Rollback rehearsed on one category | | | |
| 14 | Branch merged to `main`; `deploy.sh` run verified media survives | | | |
| 15 | **Cloudinary cleanup approved** (separate, explicit) | | | |
