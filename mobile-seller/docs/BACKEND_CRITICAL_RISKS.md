# Backend Critical Risks — found during Seller app static review

Audience: the Bulkimart backend owner. Found by reading `backend/` source only (2026-10-31). No backend code was changed and nothing was executed.
These must be fixed (or accepted in writing) **before the Seller app is used in production**.

**Remediation specification (Stage 5):** `STAGE_5_BACKEND_SECURITY_PLAN.md` (per-finding plan and implementation order), `BACKEND_API_CHANGES_REQUIRED.md` (endpoint contracts), `SECURITY_TEST_CASES.md` (tests). Correction from Stage 5 review: `requireApprovedSeller` already lets admin tokens through, so R7 needs no separate admin route.

| # | Risk | Severity | Where |
|---|---|---|---|
| R1 | Onboarding steps 1–3 and submit ignore seller status | **Critical** | `backend/controllers/seller.controller.js` `submitStep1`, `submitStep2`, `submitStep3`, `submitApplication` |
| R2 | Bank details can be overwritten without review | **Critical** | `submitStep3` |
| R3 | KYC and bank documents stored at public URLs | **High** | `services/cloudinary.service.js` (`uploadToCloudinary`, default public delivery) used by steps 2–4 |
| R4 | `GET /api/sellers/me` returns the whole seller record | **High** | `getMySellerProfile` |
| R5 | Aadhaar "verification" on the web is simulated | **High** (trust / compliance) | `frontend/src/modules/Seller/context/SellerContext.jsx` `verifyAadhaar` |
| R6 | Step 4 appends documents on every call | Medium | `submitStep4` (`seller.documents.concat(...)`) |
| R7 | Product delete / list skip the seller-session check | Low | `routes/product.routes.js` (`DELETE /:id`, `GET /seller/mine`) |

## R1 — Onboarding endpoints have no status guard (Critical)

**What:** `PUT /api/sellers/step/1`, `/step/2`, `/step/3` and `POST /api/sellers/submit` only check that a Seller record exists. They don't check `seller.status`. Step 4 checks status only for GST choices.

**Impact:**
- An **approved** seller (or anyone holding their token) who calls `POST /api/sellers/submit` has `status` set back to `pending`. The panel locks (`requireApprovedSeller`) until an admin re-approves. This is self-inflicted downtime, and a stolen token can do it to someone else.
- Step 1 can rename the business or change the store address and pickup details on a live store without review (it also re-queues pickup sync).
- Step 2 replaces Aadhaar images without review.

**Change needed:**
- Allow steps 1–4 and submit only while `status ∈ { incomplete }`, plus `rejected` once a defined resubmission flow exists.
- Return 409 otherwise.
- Route post-approval changes through a separate, reviewed "change request" flow.

## R2 — Bank details overwritten without review (Critical)

**What:** `submitStep3` replaces `seller.bankDetails` (account number, IFSC, holder, passbook) for any seller status.

**Impact:** a compromised seller session can redirect future payouts to another account before an admin notices. Payouts are manual today, but finance staff would see a valid-looking "seller bank" record.

**Change needed:**
- Block step 3 for non-onboarding statuses (R1).
- Add a bank-change request: pending until finance verifies it, with the old account kept active, an audit trail, and a notification to the seller's registered phone.

**App behaviour until fixed:** the app shows bank and KYC details **read-only**. Onboarding is offered only to `none`/`incomplete` sellers; rejected-seller resubmission and approved-seller bank changes stay unavailable.

## R3 — Identity and bank documents are publicly reachable (High)

**What:** Aadhaar front/back, passbook/cheque, PAN card and business certificates are uploaded with `upload_stream({ resource_type: 'auto' })` and stored as `secure_url`. With default (public) delivery, anyone who has the URL can open the file. No signature or expiry is required.

**Impact:** KYC images leak through logs, forwarded links, browser history or admin exports. That may breach data-protection obligations for Aadhaar data.

**Change needed:**
- Upload KYC with `type: 'authenticated'` (or private).
- Serve through short-lived signed URLs, generated only for the owner and authorised admins.
- Migrate existing files.

**App behaviour:** the app never opens these URLs. It shows "On file" only.

## R4 — Over-broad seller profile response (High)

**What:** `GET /api/sellers/me` returns the full `Seller` document: full bank account number, PAN, document URLs and internal fields.

**Impact:** any client, or a script using a seller token, receives more personal and financial data than any screen needs.

**Change needed:** return a projection: masked account number (last 4), masked PAN, document *presence* and types instead of URLs, and omit internal fields.

**App behaviour:** the app masks the account number and PAN and hides the document URLs, but the data still reaches the device.

## R5 — Simulated Aadhaar verification (High)

**What:** the web `verifyAadhaar()` waits 1.5 s and shows "Aadhaar verified successfully!" without calling any service. The backend stores only the masked number and the images.

**Impact:** sellers and admins may believe Aadhaar was verified when it wasn't. This is a compliance and trust issue, and an admin approving on that basis is misinformed.

**Change needed:** remove the fake success message from the web, and either integrate a real KYC provider (consent-based, with an audit log) or label it as "manual review by Bulkimart".

**App behaviour:** the app doesn't reproduce it. It says Aadhaar is reviewed by Bulkimart.

## R6 — Step 4 duplicates documents (Medium)

**What:** every call to step 4 appends the uploaded files to `seller.documents`.

**Impact:** retries create duplicate entries and confuse admin review.

**Change needed:** replace documents by type (upsert on `type`) instead of appending.

**App behaviour:** the onboarding wizard never re-sends a completed step.

## R7 — Product delete/list without a seller session (Low)

**What:** `DELETE /api/products/:id` and `GET /api/products/seller/mine` use `requireRole('seller')` but not `requireSellerSession`. Ownership is still checked (`assertOwnsProduct`).

**Impact:** a customer-portal session of the same person can delete their own listings. This is an inconsistency with the other product write routes rather than a cross-account hole.

**Change needed:** add `requireSellerSession` to both routes.

## Already-confirmed safe points (for reference)

- Payout requests are idempotent (`Idempotency-Key` header in `requestSellerPayout`) and the response hides bank details (`payoutPublic`).
- Order status changes are guarded server-side: payment readiness, `version` concurrency, the allowed transition set, and multi-store orders are blocked.
- Push tokens are scoped to the session role (`registerPushToken` / `sessionRoles`).
