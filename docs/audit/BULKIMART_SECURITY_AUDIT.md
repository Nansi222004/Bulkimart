# Bulkimart — Security Audit

Audit date 2026-11-04 · commit `76e6bc8` · read-only. No exploitation against any deployed system was performed. The only dynamic test was an isolated local Express probe with no database (F-002).

## 1. Findings by exploitability and impact

| ID | Sev | Who can exploit | Effort | Business impact |
|---|---|---|---|---|
| F-001 | **P0** | Any customer (self-registration by phone OTP) | One HTTP request | Unlimited free wallet balance → free goods; sellers paid from platform funds |
| F-002 | P1 | Any admin account lacking `manage_finance` | Change URL letter case | Payout settlement and rejection, finance policy, commission, COD write-off, refund recovery, PII report export |
| F-003 | P1 | An assigned rider | Scripted loop (≈4,500 requests on average) | False delivery completion; COD or prepaid goods diverted; rider earnings credited |
| F-004 | P1 | Any customer | Repeated unpaid online checkouts | Inventory lock-up (availability DoS); coupon-limit exhaustion |
| F-007 | P2 | Anyone holding a stolen token | — | 30-day validity, no revocation; tokens in `localStorage` |
| F-008 | P2 | — | — | OTP state per process; inconsistent limits if multiple instances |
| F-011 | P2 | An assigned rider | ≈5 guesses/min | Return-pickup OTP brute force (slower than F-003) |
| F-010 | P3 | Anyone who sees the lock screen | — | Delivery OTP in push notification text |
| F-013 | P3 | A customer | — | Sees commission and seller-net breakdown of their own order |
| F-015 | P2 | Supply chain | — | `"*"` dependency ranges |

Details, evidence and fixes for F-001 to F-005 are in the main report §4.

## 2. Controls verified as sound

| Area | Evidence |
|---|---|
| JWT | Secret required at boot (no fallback); HS256 pinned on sign and verify (`config/jwt.js`); claims shape-validated; deactivated accounts rejected (`auth.middleware.js:52`) |
| Role separation | `requireCustomerSession` rejects seller-portal tokens; `requireSellerSession`; `requireApprovedPartner` on rider routes; admin router guarded by `protect, requireAdmin` (`admin.routes.js:88`) |
| Login OTP | `crypto.randomInt`; stored as a hash; timing-safe compare; single use; max verify attempts; resend cooldown and hourly cap; express-rate-limit on send and verify routes. The fixed mock code works only when `OTP_MODE` mock is explicitly authorised. |
| Customer data isolation | Order read, track and cancel; return read; payment status; support chat (`findOne({_id, userId, userRole})`); tickets (`findOne({_id, userId})`) |
| Seller isolation | Products: `assertOwnsProduct` on update, stock, delete and channel. Fulfilment: `sellerAndOrder` requires every item to belong to the seller. Payout: `Seller.findOne({_id, userId})`. |
| Socket.IO | Handshake requires a valid JWT. Room joins are derived from the token identity, not from client-supplied ids (`socket/socket.js`). |
| Webhooks | Razorpay HMAC over the raw body, timing-safe; event amount and currency verified; unknown orders acknowledged and ignored |
| Payment manipulation | Client never sends amounts; coupon by code only; server recomputes totals; live Razorpay re-fetch on verify |
| CORS | Exact origins only; wildcard rejected; production default is `bulkimart.in` |
| Headers | `helmet()` enabled, **CSP disabled** (`index.js`). See recommendation. |
| XSS | No `dangerouslySetInnerHTML` with dynamic content in `frontend/src` (only static `<style>` blocks) |
| NoSQL injection | Express 5 default `simple` query parser (no nested objects from query strings); ids validated with `isValidObjectId` in finance paths; coupon code is `String()`-coerced |
| Secrets in git | `.env`, `google-services*.json`, `*.jks`, Firebase service account and `private-data` are git-ignored; tracked `frontend/.env.*` hold only public URLs |
| KYC files | Not served statically (`index.js` comment and route list); signed private media links (`mediaResponse` middleware), not reviewed in depth |

## 3. Additional observations (not confirmed defects)

- **No global API rate limit.** `apiLimiter` is defined in `rateLimit.middleware.js:58` but never mounted. Only auth, geo, wholesale, support chat, media and payment-recovery routes are limited. This is relevant to F-003 and to scraping.
- **Admin wallet adjustments** (`/api/wallet/admin/users/:userId/credit|debit`) require only `requireAdmin`, not `manage_finance`. Any admin can credit a customer wallet with a reason string.
- **Admin role model:** `moderator`, `admin` and `superAdmin` exist, but outside finance (`manage_finance`) and marketing (`marketingPermission`) every admin route is open to every admin role. Confirm this is intended.
- **CSP disabled.** With tokens in `localStorage`, any future XSS becomes full account takeover. Consider an allow-listed CSP and httpOnly cookies, or shorter-lived tokens.
- **`trust proxy` = 1** is correct only if exactly one proxy sits in front. With a CDN plus Nginx, rate limits key on the proxy IP. Verify with the server configuration.
- **Logging:** sensitive values were not observed in the payment and OTP logs reviewed. A full log review was not performed.

## 4. Not covered

- File-upload validation and Cloudinary signing
- Media signing keys
- Admin password reset flow
- Parcel, legal, GST assistance and advertising endpoints
- Mobile app storage (Keychain or EncryptedSharedPreferences)
- Nginx/TLS configuration
- Dependency CVE scan (`npm audit` was not run, to avoid network installs on this machine)
