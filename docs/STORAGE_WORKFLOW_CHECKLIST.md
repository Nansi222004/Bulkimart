# Storage Workflow Checklist

Every upload location across the platform, with migration status. A box is ticked only with evidence (link in **Evidence**). Details for each ID: [PLATFORM_STORAGE_AUDIT.md](PLATFORM_STORAGE_AUDIT.md).

Legend: ✅ done with evidence · ☐ not started · — not applicable · 🔒 already on our server before this project

Clients: W customer web · CA customer Android (`mobile-user`) · SW seller web · SA seller Android (`mobile-seller`) · DW delivery web · AP admin panel

| ID | Workflow | Clients | Category | Audited | Implemented | Staging tested | New uploads on server | Existing assets copied + verified | Cutover | Cloudinary cleanup approved | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | Customer profile photo | W, CA | customer.avatar | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| C2 | Address landmark photo | W, CA | customer.landmark | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| C3 | Product review photos | W, CA | customer.review | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| C4 | Return request evidence | W, CA | customer.return | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| C5 | Customer support ticket attachments | W, CA | shared.ticket | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| C6 | Service / Legal / GST documents | W, CA | private service store | ✅ | 🔒 | ☐ (regression) | 🔒 | — | — | — | |
| C7 | Image search query image | W, CA | not stored | ✅ | — | ☐ (indexer origin) | — | — | — | — | |
| S1 | Product images (retail/grocery/wholesale/e-book cover) | SW, SA | seller.product | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| S2 | Bulk product upload images | SW | seller.product | ✅ | Implemented (untested) | ☐ | ☐ | — (same assets as S1) | — | — | |
| S3 | E-book PDF | SW | private e-book store | ✅ | 🔒 | ☐ (regression) | 🔒 | — | — | — | |
| S4 | Seller Aadhaar front/back | SW, SA | seller.kyc | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| S5 | Seller bank passbook | SW, SA | seller.bank | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| S6 | Seller PAN / trade licence | SW, SA | seller.kyc | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| S7 | Store logo / banner | SW, SA | seller.branding | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| S8 | Seller account avatar | SW | customer.avatar | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| S9 | Seller support ticket attachments | SW, SA | shared.ticket | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| D1 | Rider driving licence | DW | delivery.kyc | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| D2 | Rider Aadhaar front/back | DW | delivery.kyc | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| D3 | Rider bank passbook | DW | delivery.bank | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| D4 | Rider support ticket attachments | DW | shared.ticket | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| A1 | Banners (desktop/mobile image) | AP | admin.banner | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| A2 | Storefront Studio images | AP | admin.storefront | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| A3 | Storefront hero/splash video | AP | admin.storefront | ✅ | Implemented (untested; validate, no transcode) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| A4 | Category image + icon | AP | admin.category | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| A5 | Campaign banner | AP | admin.campaign | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| A6 | Push broadcast image | AP | admin.broadcast | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| A7 | Admin ticket replies / internal notes | AP | shared.ticket | ✅ | Implemented (untested) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| A8 | Admin KYC dossier viewing (signed, audited) | AP | read path | ✅ | Implemented (untested) | ☐ | — | — | — | — | |
| X1 | Packaging images (route retired) | — | data only | ✅ | — | — | — | ☐ | ☐ | ☐ | |
| X2–X3 | Legacy fields (promotions, ration packages, `Order.returnImages`, etc.) | — | data only | ✅ | — | — | — | ☐ | ☐ | ☐ | |
| SN | Snapshot URLs (order items, order landmark, return product image, notifications) | all | read-time map only | ✅ | Implemented (untested) | ☐ | — | ☐ | never rewritten | ☐ (decision D4) | |

## Platform-level items

| Item | Status | Evidence |
|---|---|---|
| Infrastructure gate G1–G10 answered | Done except G4 (bandwidth) and G10 (Cloudinary usage) | [Infrastructure report §0](STORAGE_INFRASTRUCTURE_REQUIREMENTS.md) |
| Persistent media directory `/var/lib/bulkimart` (approved; root disk, not a separate volume) | Approved, not yet created | [Deployment runbook §2](STORAGE_DEPLOYMENT_RUNBOOK.md) |
| Backups + restore drill | **Blocked — deferred by owner; launch blocker** | [Backup runbook](STORAGE_BACKUP_RESTORE_RUNBOOK.md) |
| Reverse proxy limits/timeouts | Verified sufficient (64 MB, 900 s); no change needed | [Infrastructure report §0](STORAGE_INFRASTRUCTURE_REQUIREMENTS.md) |
| Central storage service implemented | Implemented (untested) | [Implementation report](STORAGE_IMPLEMENTATION_REPORT.md) |
| Media delivery routes + signed URLs | Implemented (untested) | [Implementation report](STORAGE_IMPLEMENTATION_REPORT.md) |
| Access audit logging (KYC views) | Implemented (untested) | [Implementation report](STORAGE_IMPLEMENTATION_REPORT.md) |
| Silent `/uploads` fallback removed | Implemented, not tested | [Implementation report](STORAGE_IMPLEMENTATION_REPORT.md) |
| Hotfix: add `seller-docs`, `delivery-bank` to sensitive folder list | Implemented, not tested | [Implementation report](STORAGE_IMPLEMENTATION_REPORT.md) |
| Image search indexer accepts media origin | Implemented (untested) | [Implementation report](STORAGE_IMPLEMENTATION_REPORT.md) |
| Cloudinary dependency and credentials removed | ☐ | |

## Per-application sign-off

| Application | Tester | Date | Result | Evidence |
|---|---|---|---|---|
| Customer website | | | | |
| Customer Android (`mobile-user`) | | | | |
| Seller website | | | | |
| Seller Android (`mobile-seller`) | | | | |
| Delivery partner portal | | | | |
| Admin panel | | | | |
