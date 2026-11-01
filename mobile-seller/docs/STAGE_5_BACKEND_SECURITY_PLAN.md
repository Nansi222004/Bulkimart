# Stage 5 — Backend Security Remediation Plan

Audience: Bulkimart backend owner and reviewers. Status: **specification only. No backend code has been changed.**
Evidence: static reading of `backend/` and `frontend/` (2026-10-31). File and line references are to the current working tree.
Companion documents: `BACKEND_API_CHANGES_REQUIRED.md` (endpoint contracts), `SECURITY_TEST_CASES.md` (tests).

## 0. Summary

| ID | Finding | Priority | Phase |
|---|---|---|---|
| R1 | Onboarding steps 1–3 and submit ignore seller status | **P0 Critical** | 1 |
| R2 | Bank details can be overwritten without review | **P0 Critical** | 1 (block) → 3 (workflow) |
| R3 | KYC and bank documents at public Cloudinary URLs | **P1 High** | 4 |
| R4 | `/api/sellers/me` and admin detail over-share sensitive data | **P1 High** | 2 |
| R5 | Web "Verify Aadhaar" is simulated | **P1 High** (compliance) | 1 (remove claim) → 5 (decision) |
| R6 | Step 4 appends duplicate documents | P2 Medium | 1 |
| R7 | Product list/delete skip seller-session check | P3 Low | 1 |

Related scope (same patterns, not seller-app work): delivery-partner onboarding (`controllers/deliveryPartner.controller.js`) also stores Aadhaar and bank documents on public Cloudinary and writes bank details in an onboarding step. Apply R2–R4 there too.

Existing controls this plan builds on (don't remove them):
- `parseStoreProfile` (`services/sellerProfile.service.js`) already rejects `status`, `bankDetails`, `aadhaar`, approval fields and similar in `PUT /api/sellers/profile`.
- Seller payouts snapshot `bankDetails` at request time (`services/sellerPayout.service.js`). `destinationFingerprint` (`services/payoutEvidence.service.js`) and `verifySellerPayoutBeneficiaryAdmin` (`controllers/adminSellerFinance.controller.js`) require admin ownership evidence per payout, bound to that fingerprint. `payoutPublic` hides bank details in responses.
- Private file storage already exists: `services/serviceStorage.service.js` refuses public folders, requires configuration in production, and is served by authenticated controllers with `no-store` (e.g. `gstAssistance.controller.js::download`).
- An audit model exists (`models/AccountActionAudit.js`), but its enums only cover account deletion and deactivation.

---

## R1 — Onboarding authorization (P0)

**Current behaviour**
- `PUT /api/sellers/step/1`, `/step/2`, `/step/3` and `POST /api/sellers/submit` (`controllers/seller.controller.js` ≈ lines 115–339) load the seller by `userId` and write without checking `status`.
- `submitApplication` sets `status = 'pending'` whenever `onboardingStep >= 5`.
- `submitStep4` checks status only when a GST choice is sent (it allows `incomplete` and `rejected`).
- Uploads to Cloudinary happen **before** any check, so blocked calls would still create files.
- The routes sit above `requireApprovedSeller`, by design (onboarding must stay open), and use `protect` + `requireSellerSession` only.

**Security impact**
- An approved seller (or a stolen seller token) can call `submit` and push the store back to `pending`. `requireApprovedSeller` then locks the whole panel until an admin re-approves. This is denial of service on a live store.
- Step 1 can rename the business or move the store address and pickup on a live store without review (it also re-queues Shiprocket pickup sync).
- Step 2 replaces Aadhaar images; step 3 replaces bank details (R2).
- Status manipulation: a suspended seller calling `submit` moves to `pending`. That escapes the "suspended" label and may re-enter the admin approval queue.

**Required change**
1. Add an onboarding-status guard to every onboarding write, **before** any upload or parse side-effect:

   | Seller status | start | step 1–4 | submit |
   |---|---|---|---|
   | none (no record) | ✅ creates | 404 (unchanged) | 404 |
   | `incomplete` | ✅ | ✅ | ✅ if `onboardingStep >= 5` |
   | `pending`, `under_review` | ✅ no-op (returns current) | **409 `APPLICATION_UNDER_REVIEW`** | **409** (idempotent: return current if already pending) |
   | `rejected` | ✅ no-op | **409 `RESUBMISSION_NOT_AVAILABLE`** until the resubmission flow (R1-b) ships | **409** |
   | `approved` | ✅ no-op | **409 `SELLER_ALREADY_ONBOARDED`** | **409** |
   | `suspended` | ✅ no-op | **409 `SELLER_SUSPENDED`** | **409** |

2. Make the writes **atomic**: `Seller.findOneAndUpdate({ userId, status: 'incomplete' }, …)`. For submit, add `onboardingStep: { $gte: 5 }`. This closes the race where an admin approves while a step is in flight. If nothing matches, return the 409 for the current status.
3. Remove the step-4 exception for `rejected` (`['incomplete','rejected']` → `['incomplete']`) until R1-b exists. **Decision needed:** this makes rejected sellers unable to change their GST choice. That matches today's web, which offers rejected sellers no editing.
4. Record `submittedAt` on submit, plus an audit event (see "Audit model" below).
5. *(R1-b, later, needs a product decision)* Resubmission flow: an admin "request changes" action → a new status (e.g. `changes_requested`) with the fields to fix → seller edits only those sections → resubmit → back to `pending`. Until then, rejected sellers contact support.

**Routes / models:** `routes/seller.routes.js` (start, step/1–4, submit); `controllers/seller.controller.js`; `models/Seller.js` (no schema change for the guard; R1-b would add a status and fields).

**Migration:** none for the guard. Run a read-only report first: sellers whose `submittedAt` is later than `approvedAt`, or whose `status` history suggests resets (if logs exist). Investigate any found.

**Compatibility**
- Web: `OnboardingPage` only renders for `none`/`incomplete`, so no visible change. The step-4 rejected case loses its only path, which no web UI uses.
- Mobile: `OnboardingScreen` is gated to `onboarding` (`none`/`incomplete`), so no change. New 409 codes surface as messages.
- Admin: none.

**Tests:** SEC-R1-01 … SEC-R1-12. **Priority:** P0.

---

## R2 — Bank details protection (P0)

**Current behaviour**
- `submitStep3` replaces `seller.bankDetails` (account number, IFSC, holder, bank, UPI, passbook URL) for any status. No review, no history, and no notification to the seller.
- Mitigation that already exists: each payout snapshots `bankDetails`, and finance must record ownership evidence bound to that snapshot's fingerprint (`beneficiary-review`) before paying.

**Security impact**
- A compromised seller session can redirect **future** payouts.
- The per-payout beneficiary review makes the attacker produce plausible "ownership evidence", but reviewers see a seller-owned record and may accept it.
- No trail shows who changed the account or when, and the real seller isn't told.

**Required change**
- **Phase 1 (block):** the R1 guard makes step 3 unusable after onboarding. Approved sellers can no longer change bank details through the API. The mobile app is already read-only; the web has no post-approval bank form.
- **Phase 3 (workflow):** a reviewed bank change request.
  - New model `SellerBankChangeRequest`:
    - `sellerId`, `requestedBy` (userId), `status` (`PENDING`|`APPROVED`|`REJECTED`|`CANCELLED`)
    - `proposed { holderName, bankName, accountNo, ifsc, upiId }`
    - `proposedFingerprint`, `previousFingerprint`
    - `evidence` (private file reference, R3)
    - `submittedAt`, `reviewedBy` (Admin), `reviewedAt`, `decisionReason`, `evidenceReference`
    - `idempotencyKey` (unique)
  - Index: a partial unique index on `{ sellerId }` where `status: 'PENDING'` (one open request per seller).
  - **Seller endpoints** (approved sellers): create (multipart with evidence file); view own (masked); cancel own pending request.
    Step-up check recommended: require a fresh seller OTP within N minutes (reuse `/api/auth/seller/verify-otp` and stamp the session), so a stolen long-lived token alone can't redirect payouts. **Decision needed.**
  - **Admin endpoints** (permission `manage_finance` or a new `verify_seller_bank`):
    - list and detail: masked by default; full number via an audited reveal (R4)
    - approve: one transaction that sets `seller.bankDetails` from `proposed`, marks the request `APPROVED`, writes an audit event and bumps a `bankDetailsVersion`
    - reject: with a reason
  - **Notifications:** on create, approve and reject, notify the seller on their **registered phone**/push, so the real owner learns of an unexpected change.
  - **Payout rules:**
    - Requests already `PENDING` keep their snapshot (unchanged). Beneficiary review already fails if the fingerprint differs.
    - While a bank change is `PENDING`, new payout requests are allowed to the **current verified** account. **Decision needed:** the alternative is to block new requests until review (stricter, but disrupts weekly payouts).
    - After approval, recommend a cooling-off period (e.g. 24 h, configurable) before the first payout to the new account, plus a mandatory fresh beneficiary review.
  - **Audit history:** every create, cancel, approve, reject and reveal → an audit event. Keep previous `bankDetails` versions in the audit record (masked) for dispute handling.
  - **Optional (P2):** field-level encryption of `accountNo` at rest, using a KMS-managed key.

**Routes / models:** new `routes/sellerBankChange.routes.js` (mounted under `/api/sellers/bank-change-requests` and `/api/admin/seller-bank-changes`); `models/SellerBankChangeRequest.js`; `models/Seller.js` (`bankDetailsVersion`); `services/sellerPayout.service.js` (cooling-off check); notification events.

**Migration:** none for existing bank records. Start every current seller at `bankDetailsVersion: 1` (the default; no backfill needed).

**Compatibility:** web gets a new optional screen. Mobile replaces the "contact support" text in `KycDetailsScreen` with a request form (a later app stage). Admin gets a new review queue. Nothing existing breaks.

**Tests:** SEC-R2-01 … SEC-R2-13. **Priority:** P0 (block), P1 (workflow).

---

## R3 — Private KYC document storage (P1)

**Current behaviour**
- `uploadToCloudinary` (`services/cloudinary.service.js` ≈ line 124) uses `upload_stream({ folder, resource_type: 'auto' })` and stores `secure_url`.
- With default delivery type `upload`, these are **public**: anyone holding the URL can fetch them, with no expiry.
- Used for Aadhaar front/back (`seller-kyc/<userId>`), passbook (`seller-bank/…`), legal documents (`seller-docs/…`), and the same for delivery partners.
- URLs are returned to the seller (`/sellers/me`) and to admins (`/admin/sellers/:id`), and probably appear in logs and exports.

**Security impact**
- Aadhaar images and bank documents leak through copied links, browser history, logs, analytics or admin exports.
- This likely conflicts with Aadhaar handling obligations and India's DPDP Act 2023 (purpose limitation, reasonable security safeguards). Confirm with counsel.

**Required change**
1. **Storage:** upload KYC and bank files as Cloudinary `type: 'authenticated'` (or `private`). Alternatively, reuse the existing private storage service (`serviceStorage.service.js`) if the backend host has durable, backed-up private disk. **Decision needed:** confirm the deployment's disk persistence. Cloudinary authenticated assets avoid that dependency.
2. **Data model:** replace URL strings with references:
   `{ fileId, storage: 'cloudinary_authenticated'|'private_disk', publicId, format, bytes, sha256, uploadedAt, uploadedBy }`.
   This applies to `aadhaar.front/back`, `bankDetails.passbook`, and `documents[]`. Keep the old URL fields read-only during migration.
3. **Delivery:** follow the existing GST download pattern. The server streams the bytes after authorising, with `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, a sandbox CSP and `Content-Disposition`.
   - Owner: `GET /api/sellers/me/documents/:fileId` (approved and onboarding sellers; own files only).
   - Admin: `GET /api/admin/sellers/:id/documents/:fileId` (permission `manage_sellers` or `verify_seller_kyc`; every view audited).
   - If a URL is unavoidable (large files, an admin viewer), issue Cloudinary signed delivery URLs with **≤ 5 min** expiry, generated per request. Never store or log them.
4. **Authorisation:** sellers only see their own files. Admins need an explicit permission; today **any** admin can open `/admin/sellers/:id`.
5. **Prevent re-exposure:** add a lint or test rule that KYC and bank fields never serialise a raw `url` in any response DTO (R4).

**Migration** (staged, reversible; run on staging first):
1. **Inventory** (read-only): count sellers and delivery partners with each document field, and total bytes.
2. **Copy:** for each asset, re-upload into `authenticated` type (Cloudinary `upload` from the existing URL, or the Admin API rename to type `authenticated`). Compute sha256 and compare with the original fetch.
3. **Dual-read:** the backend serves the new reference if present, otherwise the legacy URL. The responses already go through the new download endpoints, so clients don't change.
4. **Verify:** 100% of records have a new reference with a matching hash, and spot-checks pass.
5. **Cut over:** stop writing legacy URLs, and stop returning them anywhere.
6. **Revoke:** after a retention window (e.g. 14 days, for rollback), `destroy` the public originals and invalidate the CDN. Note that links already leaked stay valid until destroyed, so this step matters.
7. **Audit:** a migration log per asset (old publicId, new publicId, hash, timestamp, operator).

**Compatibility**
- Web seller panel: doesn't render KYC URLs today, so no impact.
- Admin `SellerDetailModal`: switch document links to the admin download endpoint.
- Mobile: no impact. The app never opens these URLs (Stage 4); a later stage may add "view" through the owner endpoint.

**Tests:** SEC-R3-01 … SEC-R3-11. **Priority:** P1.

---

## R4 — Minimum-necessary response objects (P1)

**Current behaviour**
- `GET /api/sellers/me` (`getMySellerProfile`) returns the whole populated Seller document: full `bankDetails.accountNo`, `pan`, Aadhaar image URLs, passbook URL, documents, internal fields (`pickupSync.history`, `commissionRate`, `promoRequests`, …).
- `GET /api/admin/sellers/:id` returns `bank: seller.bankDetails` (full) and all document URLs. `SellerDetailModal` displays the **full account number**.
- Admin seller routes require only `protect, requireAdmin`; no seller-management permission was found in `routes/admin.routes.js`.
- Already safe: `payoutPublic` returns `accountLast4` only.

**Security impact:** over-exposure to any client or script holding a seller token, and to every admin role, increases breach impact and conflicts with data minimisation.

**Required change:** introduce explicit DTO builders. Responses never spread the Mongoose document.

| Field | Seller self (app + web) | Admin list | Admin KYC detail (default) | Admin reveal (audited, permission) | Internal services |
|---|---|---|---|---|---|
| identity, status, `rejectionReason`, dates | ✅ | status only | ✅ | — | ✅ |
| `storeDetails` (name, address, contact, logo, banner, coords) | ✅ | name, city | ✅ | — | ✅ |
| `salesChannels`, `wholesaleChannel.status`, `sameDay` | ✅ | channels | ✅ | — | ✅ |
| `bankDetails.accountNo` | `accountLast4` | — | `accountLast4` | full | full |
| `bankDetails.ifsc`, `bankName`, `holderName` | ✅ | — | ✅ | — | ✅ |
| `bankDetails.upiId` | `upiPresent: bool` | — | masked (`ab***@upi`) | full | full |
| `pan` | `panLast4` | — | masked `XXXXX1234X` | full | full |
| `gstin` | ✅ (appears on invoices) | ✅ | ✅ | — | ✅ |
| `aadhaar.number` | already masked (`XXXX-XXXX-1234`) | — | masked | — (never stored in full) | masked |
| Document files | `[{ fileId, type, uploadedAt, present }]`, no URLs | count | `[{ fileId, type, uploadedAt }]` + view via R3 endpoint | — | references |
| `pickupSync.history`, `financialLedgerVersion`, `promoRequests`, `brandRequests`, `__v` (except `version`) | ✗ (`version` kept for concurrency) | ✗ | as needed | — | ✅ |
| `commissionRate` | ✗ unless a product decision says sellers see it | — | ✅ | — | ✅ |
| `limits` | ✅ | — | — | — | — |

- **Admin reveal:** `POST /api/admin/sellers/:id/reveal` with `{ field: 'accountNo'|'pan'|'upiId', reason }`. Requires a permission (e.g. `view_seller_sensitive`), is rate-limited, and records an audit event (who, when, why). Returns the single value with `no-store`.
- **Admin permission:** gate `/admin/sellers*` behind `manage_sellers` (the name used by the GST assistance router), with `superAdmin` bypass, matching that router.

**Routes / models:** `getMySellerProfile`, `getSellerDetail`, `listSellers`, every response that returns `seller` (`submitStep1–4`, `submitApplication`, `updateStoreProfile` all return `{ seller }`); new `services/sellerDto.service.js`.

**Migration:** none (response shape only).

**Compatibility**
- **Web seller panel:** reads none of the removed fields (checked statically: no use of `bankDetails`, `pan` or document URLs from `/sellers/me`). Keep every field it uses: `storeDetails`, `status`, `salesChannels`, `wholesaleChannel`, `sameDay`, `__v`/`version`, `userId` populated (name, phone, email), `rejectionReason`, `businessName`.
- **Mobile:** `KycDetailsScreen` and the `OnboardingScreen` pre-fill read `bankDetails.*`, `pan`, `aadhaar.*Url`, `documents[].url`. Both need a small update to the DTO names (`accountLast4`, `panLast4`, `documents[].present`). Ship that app change **with** or **before** the backend change; the app already treats these as optional.
- **Admin:** `SellerDetailModal` shows `d.bank.accountNo` and `d.legal.pan` in full → switch to masked plus a "Reveal" button.

**Tests:** SEC-R4-01 … SEC-R4-10. **Priority:** P1.

---

## R5 — Aadhaar verification (P1, compliance)

**Current behaviour**
- Web `verifyAadhaar()` (`frontend/src/modules/Seller/context/SellerContext.jsx` ≈ line 1196) waits 1.5 s and shows "Aadhaar verified successfully!". No backend call is made.
- The backend stores only the masked number and the images. Admin code comments describe KYC review as "deliberately manual".
- **No verification provider exists** in code or dependencies (searched for DigiLocker, UIDAI, offline e-KYC and common KYC vendors: none).

**Impact:** sellers are told something false, and admins may believe Aadhaar was verified. This is a trust and compliance risk.

**Required change**
1. **Now (P1, frontend only):** remove the simulated success message. Relabel the step "Aadhaar details (reviewed by Bulkimart)". Don't show any "verified" badge for Aadhaar. The mobile app already does this.
2. **Store verification state honestly** (backend, `models/Seller.js`):
   `kyc: { identity: { method: 'manual_document_review' | <provider method>, status: 'not_submitted'|'submitted'|'verified'|'rejected', reviewedBy, reviewedAt, evidenceReference, notes } }`.
   - Admin approval of the seller is **not** Aadhaar verification. Record the identity review as a separate admin action with evidence.
   - Never set `verified` without an actual method result or recorded manual review.
3. **Provider decision (business and legal, not engineering):**
   - Under India's Aadhaar framework, Aadhaar authentication and e-KYC are restricted to UIDAI-authorised entities, or done through authorised intermediaries, and require informed consent.
   - Consent-based alternatives sometimes used by private businesses include Aadhaar Paperless Offline e-KYC (signed XML / Secure QR) and DigiLocker document fetch.
   - Collecting, storing and masking Aadhaar numbers and images carries obligations (masking, restricted storage, purpose limitation), and the DPDP Act 2023 adds consent and safeguard duties.
   - **These points must be confirmed by Bulkimart's legal counsel before any integration.** This plan doesn't select or assume a provider, and doesn't claim automated verification is available.
4. **Prevent false claims:** UI copy and API fields derive only from `kyc.identity.status`. Add a test that no response says "verified" unless that status is `verified`.

**Routes / models:** `models/Seller.js` (`kyc`); a new admin action `PATCH /api/admin/sellers/:id/identity-review`; frontend copy.

**Migration:** existing sellers → `kyc.identity = { method: 'manual_document_review', status: approved ? 'submitted' : … }`. Do **not** backfill `verified`; admins re-review if needed.

**Compatibility:** web copy changes; admin gets a new review action; mobile has nothing to change.

**Tests:** SEC-R5-01 … SEC-R5-05. **Priority:** P1 (copy fix), P2 (state), business-dependent (provider).

---

## R6 — Duplicate document submissions (P2)

**Current behaviour:** `submitStep4` uploads every file, then `seller.documents = seller.documents.concat(uploadedDocs)`. Retries and resubmits create duplicates. There's no idempotency key and no hash.

**Impact:** a confusing admin review, wasted storage, and an ambiguous "current" document.

**Required change**
1. **Replace by type:** `documents` holds at most one **current** entry per `type` (`pan_card`, `trade_license`, `gstin_cert`, `fssai_cert`). Uploading a type marks the previous entry `supersededAt` (kept privately for audit, not returned to clients).
2. **Duplicate detection:** compute sha256 of each upload. If it equals the current document of that type, skip storage and return the existing reference.
3. **Idempotency:** accept an `Idempotency-Key` header on step 2, 3 and 4 uploads (the same header the payout endpoint uses). Store `{ key, sellerId, step, requestHash, response }` with a TTL (e.g. 24 h). A replay with the same key and hash returns the stored response; the same key with a different hash → 409.
4. **Order of operations:** status guard (R1) → validate fields → idempotency lookup → upload → atomic update. If the update fails, delete the uploaded asset.
5. **Audit:** event per document added, replaced or skipped.

**Migration:** for existing sellers with duplicate types, keep the newest as current and mark the others superseded. Run a dry-run report first; no deletions.

**Compatibility:** web keeps working (no key = today's behaviour minus duplicates). Mobile already avoids re-sending completed steps and can add the header later.

**Tests:** SEC-R6-01 … SEC-R6-07. **Priority:** P2.

---

## R7 — Product endpoints (P3)

**Current behaviour**
- `GET /api/products/seller/mine` → `protect, requireRole('seller')`.
- `DELETE /api/products/:id` → `protect, requireRole('seller','admin')`.
- Neither uses `requireSellerSession` or `requireApprovedSeller`, unlike create, update, stock and channels.
- Ownership: `assertOwnsProduct` resolves the caller's Seller by `userId` and compares `product.sellerId`. Admins bypass it.

**Assessment:** ownership checks prevent **cross-account** access, so this is not an IDOR. They don't enforce **which portal** or **which status**:
- a customer-portal session of the same person can list and delete their listings;
- a **suspended** or **rejected** seller can still delete listings (soft delete) and read their catalogue.

Ownership alone is not enough for status-dependent business rules.

**Required change**
- `GET /seller/mine`: add `requireSellerSession`. Keep it readable for any seller status (pending sellers may need to see drafts), or restrict it to approved. **Decision needed:** recommend allowing `approved` and `suspended` (read-only).
- `DELETE /:id`: add `requireSellerSession` + `requireApprovedSeller`. Verified: `requireApprovedSeller` (`middlewares/vendor.middleware.js` line 19) returns `next()` for `req.userType === 'admin'`, and `requireSellerSession` passes admin tokens (no `tokenRole`). Admin deletion keeps working on the same route.
- Audit product deletions (actor, product, timestamp).

**Migration:** none. **Compatibility:** web and mobile already use seller sessions, so no impact. Customer-portal sessions lose access they shouldn't have.

**Tests:** SEC-R7-01 … SEC-R7-06. **Priority:** P3.

---

## Audit model (shared by R1–R7)

Extend auditing with a new `SellerSecurityAudit` collection rather than widening `AccountActionAudit`'s enums, which serve account cleanup:
`{ sellerId, actorType: 'seller'|'admin'|'system', actorId, action, before (masked), after (masked), reason, requestId, ip?, userAgent?, at }`.
- Actions: `ONBOARDING_STEP_BLOCKED`, `APPLICATION_SUBMITTED`, `BANK_CHANGE_REQUESTED|APPROVED|REJECTED|CANCELLED`, `SENSITIVE_FIELD_REVEALED`, `KYC_DOCUMENT_VIEWED|ADDED|REPLACED`, `IDENTITY_REVIEWED`, `PRODUCT_DELETED`.
- Append-only (no update or delete routes); retention per legal advice; never store full account numbers or Aadhaar numbers.

## Implementation order (minimises risk to sellers, orders and payouts)

| Phase | Contents | Why this order | Data changed | Rollback |
|---|---|---|---|---|
| 0 Prep | Read-only data reports (status anomalies, duplicate docs, public asset inventory); add the `SellerSecurityAudit` model; feature flags `SELLER_ONBOARDING_GUARD`, `SELLER_DTO_V2`, `KYC_PRIVATE_DELIVERY`; staging environment | No behaviour change | none | n/a |
| 1 Guards | R1 status guard (atomic), R2 block via R1, R6 replace-by-type + hash + idempotency, R7 session/status guards, R5 web copy fix | Rejects only abnormal calls; normal onboarding and panel flows are untouched; orders and payouts unaffected | none (R6 dry-run report only) | flag off |
| 2 Data minimisation | R4 DTOs for seller self, admin list and admin detail; admin `manage_sellers` gate; audited reveal; **ship the mobile DTO update together** | Shrinks exposure before moving files; web unaffected | none | flag → legacy serializer |
| 3 Bank workflow | R2 change requests, admin review, notifications, payout cooling-off | Depends on R1/R4; payout code changes only add a check | new collection | disable endpoints; payouts unchanged |
| 4 Private storage | R3 new uploads to authenticated storage → copy migration → dual-read → cut over → destroy public originals after the retention window | Highest-effort data migration; R4 already hides URLs, so clients don't change mid-migration | document references | dual-read until destroy; destroy only after sign-off |
| 5 Identity state | R5 `kyc.identity` state + admin identity review; provider integration only after legal approval | Business and legal dependency | new fields | n/a |

Each phase: code review → staging deploy → `SECURITY_TEST_CASES.md` subset passes → production behind its flag → monitor 409 rates and admin queues → remove the flag.

Never during remediation:
- edit existing ledger entries, payouts, payout snapshots or orders;
- change payout status or beneficiary-review history;
- delete documents before migration verification and sign-off.

## Decisions needed from the owner

1. Rejected-seller resubmission: build R1-b now, or keep it support-only?
2. Bank change step-up: require a fresh OTP? A cooling-off period, and how long?
3. New payout requests during a pending bank change: allow to the old account (recommended), or block?
4. R3 storage target: Cloudinary authenticated or private disk? (Depends on the deployment's disk durability.)
5. Admin permission names (`manage_sellers`, `view_seller_sensitive`, `verify_seller_bank`) and which roles hold them.
6. R5: whether to pursue a consent-based verification method, after legal review.
7. Should sellers see `commissionRate` in their own profile DTO?
