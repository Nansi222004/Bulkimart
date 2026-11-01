# Security Test Cases — Backend Remediation (R1–R7)

Audience: backend developers and QA. Run on **staging only**, with test accounts and test files (never real Aadhaar or bank documents). No test here has been run yet.
Type: **A** = automated (Jest/supertest against a test DB) · **M** = manual (staging, with web/admin/mobile).
Fixtures: sellers S-inc (`incomplete`, step 4 done), S-pend (`pending`), S-rej (`rejected`), S-app (`approved`, with balance and a bank account), S-sus (`suspended`), customer C (buyer only), admin A-full (superAdmin), A-ops (admin without seller/finance permissions), A-fin (finance permission).

## R1 — Onboarding authorization

| ID | Type | Precondition | Action | Expected |
|---|---|---|---|---|
| SEC-R1-01 | A | S-app token | `POST /api/sellers/submit` | 409 `SELLER_ALREADY_ONBOARDED`; status stays `approved`; `approvedAt` unchanged |
| SEC-R1-02 | A | S-app | `PUT /step/1` with a new businessName/address | 409; store name, address and pickup sync unchanged |
| SEC-R1-03 | A | S-app | `PUT /step/2` with files | 409; **no Cloudinary upload happened** (spy on `uploadToCloudinary`); aadhaar unchanged |
| SEC-R1-04 | A | S-app | `PUT /step/3` | 409; `bankDetails` unchanged (fingerprint equal before/after) |
| SEC-R1-05 | A | S-sus | `POST /submit` | 409 `SELLER_SUSPENDED`; status stays `suspended` |
| SEC-R1-06 | A | S-pend | `PUT /step/1` | 409 `APPLICATION_UNDER_REVIEW` |
| SEC-R1-07 | A | S-pend | `POST /submit` twice | 200 both times (idempotent), one audit event, `submittedAt` unchanged on the second |
| SEC-R1-08 | A | S-rej | `PUT /step/4` with `gstChoice` | 409 `RESUBMISSION_NOT_AVAILABLE` (until R1-b) |
| SEC-R1-09 | A | S-inc | full chain start → 1 → 2 → 3 → 4 → submit | all 200; final `pending`; no regression vs today |
| SEC-R1-10 | A | S-inc; admin approves **during** an in-flight step 1 (simulate the race) | step 1 completes after approval | step 1 returns 409 (atomic filter on `status:'incomplete'`); seller remains `approved` |
| SEC-R1-11 | A | customer C token (no seller) | `PUT /step/1` | 404 `Seller profile not initiated` (unchanged) |
| SEC-R1-12 | M | web + mobile on staging | normal new-seller registration | completes; no new error shown |

## R2 — Bank details protection

| ID | Type | Precondition | Action | Expected |
|---|---|---|---|---|
| SEC-R2-01 | A | S-app | `PUT /step/3` | 409 (covered by R1-04) |
| SEC-R2-02 | A | S-app | `POST /bank-change-requests` valid + `Idempotency-Key` | 201 `PENDING`; `seller.bankDetails` **unchanged**; audit `BANK_CHANGE_REQUESTED`; seller notified |
| SEC-R2-03 | A | open request exists | create another | 409 `BANK_CHANGE_PENDING` |
| SEC-R2-04 | A | same key, same body | replay | 200 same request (no duplicate) |
| SEC-R2-05 | A | same key, different body | replay | 409 `IDEMPOTENCY_KEY_REUSED` |
| SEC-R2-06 | A | S-pend / S-sus token | create request | 403 (approved sellers only) |
| SEC-R2-07 | A | A-ops (no permission) | approve | 403 |
| SEC-R2-08 | A | A-fin, wrong `fingerprint` | approve | 409; nothing changed |
| SEC-R2-09 | A | A-fin, correct fingerprint | approve | `seller.bankDetails` = proposed; `bankDetailsVersion` +1; audit; seller notified; one transaction (fail in the middle → no partial write) |
| SEC-R2-10 | A | payout `PENDING` created before approval | after approval, run beneficiary review with the old snapshot fingerprint | still bound to the **old** snapshot (snapshot unchanged); reviewing with the new fingerprint → 409 |
| SEC-R2-11 | A | cooling-off adopted | payout request right after approval | 409 `BANK_CHANGE_COOLING_OFF`; allowed after the window |
| SEC-R2-12 | A | any | every request, list and detail response | never contains the full `accountNo`, full UPI or evidence URL |
| SEC-R2-13 | M | admin UI | approve and reject flows | reasons stored; seller sees the status in the app/web |

## R3 — Private KYC storage

| ID | Type | Precondition | Action | Expected |
|---|---|---|---|---|
| SEC-R3-01 | A | flag on | onboarding step 2 upload | asset stored as `authenticated`/private; record holds `fileId`, `sha256`; no URL persisted |
| SEC-R3-02 | M | stored asset publicId | fetch the plain Cloudinary delivery URL without a signature | 401/404 (not publicly viewable) |
| SEC-R3-03 | A | S-app | `GET /api/sellers/me/documents/:ownFileId` | 200, `no-store`, `nosniff`, sandbox CSP |
| SEC-R3-04 | A | S-app | another seller's `fileId` | 404 (no existence leak) |
| SEC-R3-05 | A | customer C | owner endpoint | 403 |
| SEC-R3-06 | A | A-ops (no `manage_sellers`) | admin document endpoint | 403 |
| SEC-R3-07 | A | A-full | admin document endpoint | 200 + audit `KYC_DOCUMENT_VIEWED` with admin id |
| SEC-R3-08 | A | signed-URL mode | generated URL after expiry (≤ 300 s) | rejected by the CDN |
| SEC-R3-09 | M | migration on staging copy | run copy → verify | 100% records have new references; hashes match; legacy URLs still resolve during dual-read |
| SEC-R3-10 | M | after the destroy step | open old public URLs | 404; app, web and admin views still work |
| SEC-R3-11 | A | any seller/admin JSON response | grep the response for `res.cloudinary.com` in KYC/bank fields | none |

## R4 — Minimum-necessary responses

| ID | Type | Precondition | Action | Expected |
|---|---|---|---|---|
| SEC-R4-01 | A | S-app | `GET /api/sellers/me` | has `bank.accountLast4`, `panLast4`; **no** `bankDetails`, `pan`, document URLs, `pickupSync.history`, `financialLedgerVersion` |
| SEC-R4-02 | A | S-app | `PUT /api/sellers/profile` (valid) | response `seller` is `SellerSelfDTO` |
| SEC-R4-03 | A | S-inc | step 1–4 responses | `SellerSelfDTO` |
| SEC-R4-04 | A | A-ops | `GET /api/admin/sellers/:id` | 403 once the `manage_sellers` gate is on |
| SEC-R4-05 | A | A-full | `GET /api/admin/sellers/:id` | masked account and PAN; documents without URLs |
| SEC-R4-06 | A | A-full without `view_seller_sensitive` | `POST /reveal` | 403 |
| SEC-R4-07 | A | permitted admin | `POST /reveal {field:'accountNo', reason}` | full value; `no-store`; audit `SENSITIVE_FIELD_REVEALED` |
| SEC-R4-08 | A | permitted admin | 21 reveals in an hour | 429 |
| SEC-R4-09 | M | web seller panel | profile, same-day save, sales channels, wholesale | unchanged behaviour (`__v` still accepted) |
| SEC-R4-10 | M | mobile app (updated build) | KYC & payout details, onboarding pre-fill, edit profile | correct masked values; no crashes on the new field names |

## R5 — Identity verification honesty

| ID | Type | Precondition | Action | Expected |
|---|---|---|---|---|
| SEC-R5-01 | M | web onboarding | Aadhaar step | no "verified successfully" message; copy says "reviewed by Bulkimart" |
| SEC-R5-02 | A | new seller | `GET /api/sellers/me` | `kyc.identity.status` is `submitted` after step 2, never `verified` |
| SEC-R5-03 | A | admin approves the seller | — | `kyc.identity.status` unchanged (approval ≠ identity verification) |
| SEC-R5-04 | A | admin identity review `verified` with evidence | — | status `verified`, `reviewedBy`, `reviewedAt`, `method:'manual_document_review'`; audit event |
| SEC-R5-05 | A | static test | search UI strings and API serializers for "verified" tied to Aadhaar | only rendered when `kyc.identity.status === 'verified'` |

## R6 — Duplicate documents

| ID | Type | Precondition | Action | Expected |
|---|---|---|---|---|
| SEC-R6-01 | A | S-inc | step 4 with `pan_card` twice (different files) | one current `pan_card`; the older one `supersededAt` set, not returned to clients |
| SEC-R6-02 | A | S-inc | same file twice | second call skips upload (sha256 match); same `fileId` |
| SEC-R6-03 | A | `Idempotency-Key` replay with the same body | — | stored response; no new upload |
| SEC-R6-04 | A | key reused with a different body | — | 409 `IDEMPOTENCY_KEY_REUSED` |
| SEC-R6-05 | A | DB update fails after the upload (inject an error) | — | uploaded asset deleted; no orphan reference |
| SEC-R6-06 | A | migration dry-run on duplicated fixtures | — | report lists duplicates; no data changed |
| SEC-R6-07 | A | audit | add / replace / skip | one event each |

## R7 — Product endpoints

| ID | Type | Precondition | Action | Expected |
|---|---|---|---|---|
| SEC-R7-01 | A | customer-portal token of a user who also owns a seller | `GET /api/products/seller/mine` | 403 |
| SEC-R7-02 | A | same | `DELETE /api/products/:ownId` | 403; product not deleted |
| SEC-R7-03 | A | S-sus seller token | `DELETE /api/products/:ownId` | 403 (not approved) |
| SEC-R7-04 | A | S-app | delete another seller's product | 403 (ownership, unchanged) |
| SEC-R7-05 | A | S-app | delete own product | 200; soft-deleted; audit |
| SEC-R7-06 | A | admin token | delete any product | 200 (admin passes both guards) |

## Regression suite (run after every phase)

| ID | Type | Flow | Expected |
|---|---|---|---|
| SEC-REG-01 | A | Seller OTP login (login and register intents) | unchanged |
| SEC-REG-02 | A | Order status transitions incl. `permittedActions` | unchanged |
| SEC-REG-03 | A | Payout request with `Idempotency-Key`, then beneficiary review, then approval | unchanged ledger postings; snapshot intact |
| SEC-REG-04 | A | Finance summary, ledger and tax statement values for a fixture seller | byte-identical before/after |
| SEC-REG-05 | M | Web seller panel smoke test (dashboard, products, orders, earnings, profile) | unchanged |
| SEC-REG-06 | M | Admin seller approval and rejection | works with the new permission gate |
| SEC-REG-07 | M | Mobile seller app smoke test on a device (trusted machine) | unchanged except the intended masking |
