# Backend API Changes Required

Audience: backend implementers and reviewers. **Specification only. Nothing has been implemented.**
Companion to `STAGE_5_BACKEND_SECURITY_PLAN.md`. Error bodies keep the existing envelope `{ success:false, data:null, message, meta:{ code } }`.

Legend: **Changed** = existing endpoint behaviour changes · **New** = new endpoint · **Breaking?** = whether an existing client must change.

## 1. Onboarding (R1, R6)

| Endpoint | Change | New error codes | Breaking? |
|---|---|---|---|
| `POST /api/sellers/start` | Changed: for non-`incomplete` sellers return the current record unchanged (never resets `onboardingStep` or `status`) | — | No |
| `PUT /api/sellers/step/1` | Changed: status guard **before** parsing side-effects; atomic update filtered on `status: 'incomplete'` | 409 `APPLICATION_UNDER_REVIEW`, `RESUBMISSION_NOT_AVAILABLE`, `SELLER_ALREADY_ONBOARDED`, `SELLER_SUSPENDED` | No (web and mobile only call it while `incomplete`) |
| `PUT /api/sellers/step/2` | Changed: guard **before** Cloudinary upload; optional `Idempotency-Key` header; R3 storage | same + 409 `IDEMPOTENCY_KEY_REUSED` | No |
| `PUT /api/sellers/step/3` | Changed: guard before upload (blocks post-onboarding bank edits); optional `Idempotency-Key` | same | No |
| `PUT /api/sellers/step/4` | Changed: guard (`incomplete` only, removing the `rejected` exception until R1-b); documents **replace by type** with sha256 dedupe; optional `Idempotency-Key` | same | No for current clients. Rejected sellers lose GST edits (no client uses this today) |
| `POST /api/sellers/submit` | Changed: atomic `{status:'incomplete', onboardingStep:{$gte:5}} → {status:'pending', submittedAt}`; already `pending` → 200 with the current record (idempotent); other statuses → 409 | as above | No |
| All of the above | Response `seller` uses `SellerSelfDTO` (section 3) | — | Mobile pre-fill field names (see section 3) |

Idempotency storage (new collection `IdempotencyRecord`): `{ key, scope:'seller-onboarding', sellerId, step, requestHash (sha256 of fields + file hashes), response, createdAt (TTL 24 h) }`, unique on `{ scope, sellerId, key }`.

## 2. Bank change requests (R2) — New

**Seller** (`protect`, `requireSellerSession`, `requireApprovedSeller`):

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| POST | `/api/sellers/bank-change-requests` | multipart: `holderName, bankName, accountNo (9–18 digits), ifsc (/^[A-Z]{4}0[A-Z0-9]{6}$/), upiId?, evidence (file, ≤5 MB, image/PDF)` + header `Idempotency-Key` (+ step-up OTP proof if adopted) | `201 { data: BankChangeRequestSelfDTO }` | 409 `BANK_CHANGE_PENDING` if one is open; 400 validation as in onboarding |
| GET | `/api/sellers/bank-change-requests` | — | `{ data: [BankChangeRequestSelfDTO] }` | newest first |
| POST | `/api/sellers/bank-change-requests/:id/cancel` | — | `{ data }` | only `PENDING`, only the owner |

`BankChangeRequestSelfDTO`: `{ _id, status, proposed: { holderName, bankName, ifsc, accountLast4, upiPresent }, submittedAt, reviewedAt, decisionReason }`. Never returns the full number or an evidence URL.

**Admin** (`protect`, `requireAdmin`, permission `verify_seller_bank` or `manage_finance`, superAdmin bypass):

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/admin/seller-bank-changes?status=PENDING` | — | list with masked values, seller name, ages |
| GET | `/api/admin/seller-bank-changes/:id` | — | masked detail + `evidence: { fileId }` + current vs proposed (masked) + `proposedFingerprint` |
| GET | `/api/admin/seller-bank-changes/:id/evidence` | — | streamed file (`no-store`), audited |
| POST | `/api/admin/seller-bank-changes/:id/approve` | `{ evidenceReference, reason, fingerprint }` (fingerprint must equal `proposedFingerprint`) | `{ data }`. Transaction: set `seller.bankDetails`, `$inc bankDetailsVersion`, request → `APPROVED`, audit, notify seller |
| POST | `/api/admin/seller-bank-changes/:id/reject` | `{ reason }` | `{ data }` + audit + notify |

Payout side (`services/sellerPayout.service.js::createSellerPayoutRequest`): if adopted, reject with 409 `BANK_CHANGE_COOLING_OFF` when `now - bankDetailsChangedAt < cooling-off`. Existing payouts and snapshots are untouched.

## 3. Response DTOs (R4) — Changed responses

`SellerSelfDTO` (returned by `GET /api/sellers/me` and every seller-facing endpoint that returns `seller`):

```
{
  _id, status, onboardingStep, rejectionReason, submittedAt, approvedAt,
  businessName, businessType, email,
  userId: { _id, name, phone, email, avatar },
  storeDetails: { name, description, address, landmark, city, state, pincode, phone, email, lat, lng, logo, banner },
  salesChannels, wholesaleChannel: { status }, sameDay, partnerTier, rating,
  gstin, gstRegistrationChoice, fssai,
  panLast4,                                   // was pan (full)
  aadhaar: { number /* already masked */, frontPresent, backPresent },
  bank: { holderName, bankName, ifsc, accountLast4, upiPresent, passbookPresent },   // was bankDetails (full)
  documents: [{ fileId, type, uploadedAt }],  // no url
  version                                     // = __v, for optimistic concurrency
}
```

Removed from seller responses: `bankDetails`, `pan`, Aadhaar/passbook/document `url`s, `pickupSync.history`, `financialLedgerVersion`, `promoRequests`, `brandRequests`, `commissionRate` (pending decision), `__v` (replaced by `version`).

**Client impact**
- **Web seller panel:** none. Checked statically: it reads `storeDetails`, `status`, `salesChannels`, `wholesaleChannel`, `sameDay`, `__v`, `userId`, `businessName`, `rejectionReason`.
  - Keep `__v` alongside `version` for one release, because `SellerContext.updateSellerProfile` sends `sellerProfile.__v`.
- **Mobile:**
  - `KycDetailsScreen`: `bankDetails.*` → `bank.*`, `pan` → `panLast4`, `aadhaar.frontUrl/backUrl` → `frontPresent/backPresent`, `documents[].url` → presence.
  - `OnboardingScreen` pre-fill: `bankDetails.holderName/bankName/ifsc` → `bank.*`.
  - `EditProfileScreen`: `seller.__v` → keep or switch to `version`.
  - The mobile change ships with this backend release.

`AdminSellerListDTO` (`GET /api/admin/sellers`): `{ _id, businessName, storeName, city, status, salesChannels, submittedAt, approvedAt, ownerName }`. Drop the `bankDetails.holderName` fallback (use `userId.name`).

`AdminSellerKycDTO` (`GET /api/admin/sellers/:id`): as today's structure, but:
- `bank.accountNo` → `accountLast4`; `upiId` → masked; `legal.pan` → masked `XXXXX1234X`;
- `documents[].url` → `{ fileId, label, category, uploadedAt }`, viewed through section 4.

**New** `POST /api/admin/sellers/:id/reveal` `{ field: 'accountNo'|'pan'|'upiId', reason (5–500 chars) }`:
- permission `view_seller_sensitive`; rate limit (e.g. 20 per hour per admin);
- returns `{ data: { field, value } }` with `Cache-Control: private, no-store`;
- writes a `SENSITIVE_FIELD_REVEALED` audit event.

Admin route gate: `router.use('/sellers', requirePermission('manage_sellers'))` (superAdmin bypass), matching the gst-assistance router's check.

## 4. Private documents (R3)

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/sellers/me/documents/:fileId` | seller session, own file | streamed bytes; headers `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Content-Disposition: attachment` |
| GET | `/api/admin/sellers/:id/documents/:fileId` | `manage_sellers` (or `verify_seller_kyc`) | same + audit `KYC_DOCUMENT_VIEWED` |
| (internal) | upload helper `uploadPrivateKycFile(buffer, { sellerId, kind })` | — | `{ fileId, storage, publicId, format, bytes, sha256 }` |

No endpoint returns a Cloudinary URL for KYC or bank files. If signed URLs are used internally, expiry is ≤ 300 s and they are never persisted or logged.

## 5. Identity review (R5)

| Method | Path | Request | Notes |
|---|---|---|---|
| PATCH | `/api/admin/sellers/:id/identity-review` **New** | `{ outcome: 'verified'|'rejected', method: 'manual_document_review', evidenceReference, notes }` | Sets `kyc.identity`; audit `IDENTITY_REVIEWED`; separate from approve |
| — | `SellerSelfDTO.kyc.identity.status` **New field** | — | UI shows "Verified" only when `verified` |

Frontend (web): remove the simulated `verifyAadhaar` success. No API involved.

## 6. Products (R7)

| Endpoint | Change | Error | Breaking? |
|---|---|---|---|
| `GET /api/products/seller/mine` | add `requireSellerSession` (status policy per decision) | 403 `AUTH_ROLE_REQUIRED` | No for seller app and web |
| `DELETE /api/products/:id` | add `requireSellerSession`, `requireApprovedSeller` (admin passes both); audit deletion | 403 | No for seller app and web |

## 7. Rollout flags

| Flag | Covers | Default during rollout |
|---|---|---|
| `SELLER_ONBOARDING_GUARD` | R1, R6, step-3 block | off → on after staging tests |
| `SELLER_DTO_V2` | R4 seller self + admin DTOs + permission gate | off → on with the mobile release |
| `SELLER_BANK_CHANGE_WORKFLOW` | R2 endpoints | off until the admin UI exists |
| `KYC_PRIVATE_DELIVERY` | R3 new uploads + document endpoints; migration runs separately | off → on, then migrate |
| `SELLER_PRODUCT_SESSION_GUARD` | R7 | off → on |
