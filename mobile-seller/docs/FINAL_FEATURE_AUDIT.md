# Final Feature Audit — Bulkimart Seller (Stage 6)

Date: 2026-10-31. **Security gate: FAILED** (see section 1), so this stage is static source work only.
"Implemented" below means **written and statically checked, never built or run**. Nothing in this app is Verified.

## 1. Security gate result (checked read-only at the start of Stage 6)

| Gate condition | Evidence | Result |
|---|---|---|
| Windows cleanly reinstalled | OS install date 2026-02-17 (before the infection); same user profile | ❌ |
| Malware persistence removed | `~/.local/share/runtimedev-link/start.vbs` and `~/.config/runtimedev-link/agent.env` still present | ❌ |
| Repository sanitised | `D:\Appzeto_Projects\safe-fire\frontend\postcss.config.js` still contains a live PolinRider payload; infected commits remain in several repos' history | ❌ |
| No recent detections | Defender detection at 2026-10-31 12:55 | ❌ |
| Credentials rotated from a clean device | Not confirmed | ❌ |
| Trusted machine | — | ❌ |
| Session/account integrity | The Claude Code account context changed several times during this work (four distinct identities). The owner must confirm who has access | ⚠ |

Consequences, followed as instructed:
- No npm, npx, node, Gradle or Metro was run.
- No `android/` folder was generated.
- No build, test, lint or API call was made.
- **No backend security changes (R1–R7) were implemented.** They are gated on a trusted environment *and* backend authorisation.

## 2. Classification legend

**Implemented** (static) · **Needs completion** · **Missing backend** · **Not applicable** · **Requires payment integration** · **Requires admin configuration** · **Blocked — gate** (needs a trusted machine).

## 3. Feature inventory (web seller panel + backend vs app)

| Area | Feature | Status | Notes |
|---|---|---|---|
| Auth | Phone OTP login, register intent, session restore, logout, expiry → login, customer/admin rejection | Implemented | Single 30-day JWT; no refresh token (backend contract) |
| Auth | Approved / incomplete / pending / under-review / rejected / suspended / deactivated gating | Implemented | Server-driven gate |
| Onboarding | 7-section wizard, documents (camera/gallery/PDF), progress, failed-step resume, submit | Implemented | Typed address; GPS pin is a separate screen |
| Onboarding | Rejected-seller resubmission | Missing backend | Approved rule 1 needs the R1-b backend workflow first |
| Onboarding | Aadhaar verification | Not applicable (by decision) | Approved rule 6: wait for legal review and an authorised provider. The app never claims verification |
| Dashboard | KPIs, storefront split, 7/30-day chart, missing values shown as '—' | Implemented | Date ranges beyond 30 days: Missing backend |
| Products | List, search, status filters, detail, create, edit, delete, categories, GST, return window, variants, ≤5 photos, cover/order, retry, duplicate warning | Implemented | Physical retail listings |
| Products | E-books (digital PDF listings) | Needs completion | Backend supports create + `POST /products/:id/digital-file`; not converted yet |
| Products | Wholesale tier prices / MOQ / increment per saved variant (`PATCH /products/:id/wholesale-pricing`) | Implemented (Stage 7) | Shown only with an approved Wholesale channel; product `version` sent, 409 handled |
| Products | Create a new wholesale-only listing; edit wholesale-only listing details | Needs completion | Offers on existing wholesale-only listings can be edited in-app |
| Products | Bulk upload (CSV/XLSX template) | Needs completion | Web-only; a file workflow better suited to desktop |
| Products | Product FAQs (list, answer) | Implemented (Stage 6) | Answers are final; no moderation states in backend |
| Inventory | Overview (server counts), low/out of stock, adjust with 409 handling, first-variant rule | Implemented | Stock history: Missing backend |
| Orders | List, search, filters, detail, `permittedActions` only, reject/cancel reasons, courier dispatch | Implemented | |
| Orders | Fulfilment: manual rider, Shiprocket (Shop All) | Implemented | |
| Orders | Quick Commerce Shiprocket fee | Requires payment integration | Razorpay |
| Orders | Tracking, invoices (view) | Implemented | Invoice PDF / list endpoint: Missing backend |
| Finance | Earnings, ledger, order earnings, payout request (idempotent), payout history, TCS/TDS | Implemented | |
| Finance | Seller-wide commission-rate view (approved rule 7) | Missing backend | `Seller.commissionRate` is legacy and **not** the rate charged; real rules are versioned per channel/category/product (`vendorCommission.service.js`) with no seller endpoint. The applied rate per order line is already shown |
| Returns | List, detail, approve/reject (reason), rider / Shiprocket pickup, cancel, refresh, mark received, refund shown verbatim | Implemented | Exchanges: Missing backend. Seller OTP: Not applicable (customer-only) |
| Support | Tickets list/create/attachments/reply/reopen; server helpline | Implemented | Chat: Missing backend |
| Notifications | Inbox, read/unread, mark all, routing (orders, returns, tickets, earnings, products, advertising, FAQs) | Implemented | Per-event preferences: Missing backend |
| Notifications | FCM foreground/background/closed-app, opt-in, token removal at logout | Implemented | Device test: Blocked — gate |
| Settings | Profile edit, pickup registration, sales channels, Wholesale access request, shop same-day, logo/banner | Implemented | |
| Settings | Store GPS pin (current location → confirm → `PUT {lat,lng}`) | Implemented (Stage 6) | A map picker needs a Maps SDK + key: Requires admin configuration |
| Settings | KYC & payout details (masked, read-only) | Implemented | Bank change: Missing backend (R2 workflow; approved rule 2) |
| Advertising | Capabilities, campaign list, detail (review/payment/run states, accepted terms, server dates, quote, refund progress, history) | Implemented (Stage 6) | |
| Advertising | Create/edit draft (package, products ≤ package limit, sponsored category, requested start), submit with package confirmation, cancel unpaid / paid | Implemented (Stage 6) | Retry-safe `requestKey` |
| Advertising | Campaign payment | Requires payment integration | Razorpay; done on web for now |
| Advertising | Campaign analytics (views, clicks, click rate; free-trial split when used) | Implemented (Stage 7) | Shape confirmed in `advertisingTelemetry.service.js` |
| Advertising | Packages, approval, refunds | Requires admin configuration | Admin creates packages and approves; the app never computes refunds |
| GST assistance | Request (onboarding), fee payment | Implemented (request) / Requires payment integration (fee) | |
| Services (platform service applications) | Catalogue, applications, payments | Requires payment integration | Web-only |
| Account | Account deletion | Not applicable (deliberately excluded) | Destructive; web/support only |
| Packaging | Seller packaging orders | Not applicable | No seller web screen; only a notification route references it |
| Platform | Staging/production separation | Implemented (Stage 6) | Debug → staging (URL not provided: fails closed), release → production |
| Native | Android project, icons, splash, signing | Blocked — gate | `ANDROID_BUILD_READINESS.md` |
| Backend | R1–R7 remediation, delivery-partner KYC, admin permissions, reveal audit | Blocked — gate | Spec complete (`STAGE_5_BACKEND_SECURITY_PLAN.md`) |

## 4. Screen count

39 routed screens (34 stack screens + 5 tabs), plus one unused legacy screen (`OnboardingRequiredScreen.js`). Correction: Stage 6 reported "40", which counted the tab container as a screen. 122 files in `mobile-seller/` after Stage 7.

Stage 7 re-check of the security gate (2026-11-01): still FAILED. `runtimedev-link` files present, `safe-fire` payload present (13,099 bytes), Defender detections on 2026-10-31 (11:08 and 12:55). The `DirectXDatabaseUpdater` task found during the check is a Microsoft-signed Windows task, not malware.

## 5. Remaining work after the gate opens (in order)

1. Rebuild the machine; rotate credentials; sanitise repos (`ANDROID_BUILD_READINESS.md` §0).
2. Provide the staging API URL in `src/config/env.js`.
3. Generate `android/`, install dependencies, build, and fix native issues.
4. Run `ANDROID_TEST_REPORT.md` and `SECURITY_TEST_CASES.md` on staging.
5. Implement backend R1–R7 behind flags on staging (after authorisation), then ship the mobile DTO update.
6. Convert e-books, Wholesale pricing and advertising analytics; add payments only after Razorpay test-mode approval.
7. Release checklist (`PRODUCTION_RELEASE_CHECKLIST.md`).
