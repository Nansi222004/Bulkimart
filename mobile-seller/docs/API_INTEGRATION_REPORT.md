# API Integration Report — Bulkimart Seller

Static verification only: routes, methods and fields were read from `backend/` source and compared with the app's service layer. **No API was called.** Statuses: **MATCH** (route + fields verified in backend code or identical to the working web client) · **UNKNOWN** (route verified; some response fields known only from web display code and guarded at runtime) · **MISMATCH** (none found).

## Client behaviour (src/services/apiClient.js)

| Requirement | Implementation |
|---|---|
| Central base URL | `src/config/env.js`: debug → staging, release → production |
| No accidental production writes | **Fails closed**: if the active environment has no URL (staging is unset), every request is rejected with `API_NOT_CONFIGURED` |
| Auth interceptor | In-memory token from Keychain; `skipAuth` for public calls |
| Errors | Single `ApiError { status, code, message, body }`; network vs timeout messages; an existing `ApiError` passes through untouched |
| 401 | Ends the session only if the failing request used the *current* token |
| Timeouts | 15 s default; 120 s uploads; 45 s courier bookings |
| Upload progress | `onUploadProgress` on all multipart calls |
| Duplicate prevention | Payout `Idempotency-Key`; campaign `requestKey`; onboarding resumes without re-sending finished steps; in-flight locks on every submit |
| Response validation | Finance shapes validated (web ports); an incomplete response is an error, never ₹0 |
| Secrets | None in code; Firebase config file stays out of git |

## Endpoint table (78 calls)

The 61 calls from Stage 4 are unchanged, plus 15 new in Stage 6 (FAQs 2, geo reverse 1, store-location save 1, advertising 11).

| Module | Calls | Status |
|---|---|---|
| Auth (send-otp, verify-otp, me, logout) | 4 | MATCH |
| Seller profile / settings (me, profile PUT ×4 uses, channels, wholesale-request) | 5 | MATCH |
| Pickup sync (get, retry) | 2 | UNKNOWN |
| Dashboard | 1 | MATCH |
| Orders (list, detail, status) | 3 | MATCH |
| Order finance breakdown | 1 | UNKNOWN |
| Fulfilment options | 1 | UNKNOWN |
| Fulfilment manual / Shiprocket | 2 | MATCH |
| Invoice | 1 | UNKNOWN |
| Finance summary, ledger, tax statement | 3 | UNKNOWN |
| Payouts | 1 | MATCH |
| Products (mine, categories, return policy, create, update, delete, stock) | 7 | MATCH |
| Onboarding (start, step 1–4, submit, GST capabilities) | 7 | MATCH |
| Returns (list, detail, decision, pickup-options, pickup, refresh, cancel, mark-received) | 8 | MATCH |
| Tickets + helpline | 7 | MATCH |
| Notifications (list, unread-count, read, read-all) | 4 | MATCH |
| Push tokens (register, delete) | 2 | MATCH |
| **Stage 6:** FAQs (`GET /sellers/faqs`, `PATCH /sellers/faqs/:id/answer`) | 2 | MATCH |
| **Stage 6:** Store location (`PUT /sellers/profile {lat,lng}`), reverse geocode (`GET /api/geo/reverse`) | 2 | MATCH |
| **Stage 6:** Advertising capabilities, packages, products, campaigns list/detail, billing, create, edit, submit, cancel-unpaid (`/actions`), cancel-paid (`/cancel`) | 11 | MATCH (billing `payment` sub-object: UNKNOWN; only `quote` and `refund` are shown) |

| **Stage 7:** Wholesale pricing (`PATCH /api/products/:id/wholesale-pricing`, `protect → requireRole('seller') → requireSellerSession → requireApprovedSeller`, service `sellerWholesaleOffers.service.js`, model `Product.variants.wholesalePricing`) | 1 | MATCH |
| **Stage 7:** Campaign analytics (`GET /api/sellers/advertising/campaigns/:id/analytics`, ownership via `advertisingCampaign(id, seller._id)`, service `advertisingTelemetry.service.js`, model `AdEvent`) | 1 | MATCH |

Totals: **70 MATCH · 8 UNKNOWN · 0 MISMATCH** (78 calls). Stage 6 totals were 68 / 8 / 0 of 76. The Stage 4 grouping above folds some calls into shared rows; the totals count each distinct call once.

## Stage 6 contract notes

- **FAQs:** `{ data: { faqs: [...] } }`; the answer must be non-empty (no server length limit; the app caps input at 2000 characters for usability).
- **Advertising:**
  - `module` is `ECOMMERCE` | `QUICK`.
  - Create allows only `name, module, categoryId, items[{productId, variantId?}], packageId, requestedStartAt (ISO with timezone), requestKey`.
  - Edit requires `version` and only works while DRAFT/CHANGES_REQUESTED + UNPAID + NOT_SCHEDULED.
  - Submit requires `{version, packageVersion}`, and the app sends the version of the package it shows the seller.
  - Unpaid cancel → `/actions {action:'cancel'}`; paid cancel → `/cancel {version, reason}`.
  - Refunds are shown from `billing.refund`; the seller never receives the suggested amount (server strips it).
  - Notification events `ADVERTISING_*` map to type `system`, so the retired-promotion filter doesn't hide them.
- **Location:** the server validates lat/lng pairs and records `locationSource: 'gps'`. Reverse geocoding is display-only.

## Unresolved backend dependencies

- No staging URL documented.
- No seller commission-rules endpoint.
- No invoice PDF or list.
- No stock history.
- No exchanges.
- No notification preferences.
- No chat.
- No rejected-seller resubmission flow.
- No reviewed bank-change flow.
- (Resolved in Stage 7: advertising analytics shape confirmed.)
