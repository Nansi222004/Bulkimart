# Bulkimart Seller App — Backend Analysis and Implementation Plan

Static source review only (2026-10-31). Nothing was executed, installed or built.
Sources: `frontend/src/modules/Seller/**`, `frontend/src/components/{advertising,gst,services,finance}`,
`backend/routes/*.routes.js`, `backend/controllers/{auth,seller,notification}.controller.js`,
`backend/middlewares/{auth,error}.middleware.js`, `backend/utils/response.js`, `backend/config/jwt.js`.

---

## 1. Seller backend architecture

- Express app. Every API route is under `/api` (`backend/index.js` → `backend/routes/index.js`).
- **Response envelope** (`utils/response.js`): `{ success: true, data, message, meta }`.
  Paginated lists add `meta.page / meta.limit / meta.total`.
  Some older seller endpoints return bare keys instead, for example `/api/sellers/me` → `{ success, seller, limits }`
  and `/api/sellers/dashboard` → `{ kpis, byChannel, salesPerformance }`.
- **Errors** (`middlewares/error.middleware.js`): `{ success: false, data: null, message, meta: { code?, requestId? } }`.
- **Auth guard chain for the seller panel** (`routes/seller.routes.js`):
  `protect` (Bearer JWT) → `requireSellerSession` (token role claim must be `seller`) → `requireApprovedSeller` (Seller.status must be `approved`; applied to every operational route).
- **Seller lifecycle:** `Seller.status` is one of `incomplete | pending | under_review | approved | rejected | suspended`.
  The web panel shows the dashboard **only** for `approved`. Every other status gets a status/onboarding gate.
- **Channels:** `Seller.salesChannels` contains `ecommerce` ("Shop All") and/or `grocery` ("Quick Commerce"), plus optional `wholesale`.
- **Real-time:** a socket.io connection (`connectSocket(token,'seller',sellerId)`) carries `new_order`, `notification_new`, `rider_assigned`, etc.
  The web also polls an open order detail every 15 s.
- **Finance:** a ledger service with buckets `pending | held | eligible | reserved | settled`.
  All amounts are computed server-side. The web only *validates the shape* of finance responses (`utils/sellerFinanceRead.js`) and never derives amounts.

## 2. Seller API endpoint inventory

Auth column: P = public, S = Bearer seller session, A = S + approved seller.

### Authentication
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/auth/seller/send-otp` | P (rate-limited) | `{ phone, intent: 'login'\|'register' }` | `{ success, message, sellerState }`. Errors: 404 `NOT_A_MEMBER`/`SELLER_NOT_FOUND`, 409 `SELLER_EXISTS` |
| POST | `/api/auth/seller/verify-otp` | P (rate-limited) | `{ phone, otp, intent }` | `{ success, token, sessionRole:'seller', user, sellerState }` |
| GET | `/api/auth/me` | S | — | `{ success, sessionRole, profile, ... }` |
| POST | `/api/auth/logout` | S | — | `{ success, message }` |

### Onboarding / profile / KYC
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/sellers/me` | S | `{ success, seller \| null, limits }`. Returns 404 or `seller:null` when there is no profile |
| POST | `/api/sellers/start` | S | Start onboarding |
| PUT | `/api/sellers/step/1` | S | Business info (JSON) |
| PUT | `/api/sellers/step/2` | S | Multipart: KYC documents (`uploadFields`) |
| PUT | `/api/sellers/step/3` | S | Multipart: bank, `passbookUrl` file |
| PUT | `/api/sellers/step/4` | S | Multipart: store documents |
| POST | `/api/sellers/submit` | S | Submit for review |
| PUT | `/api/sellers/profile` | S | JSON `{name,description,phone,email,address,city,state,pincode,version}`, `{lat,lng}`, or multipart `sameDay` |
| GET/PUT | `/api/sellers/account-profile` | S | Account avatar/profile (multipart `avatar`) |
| DELETE | `/api/sellers/account` | S | Deletes the seller account (destructive; out of scope for the app) |
| GET | `/api/sellers/pickup-sync` · POST `/pickup-sync/retry` | S | Shiprocket pickup location sync |
| PATCH | `/api/sellers/channels` | A | `{ channels: ['ecommerce','grocery'] }` |
| POST | `/api/sellers/wholesale-request` | A | `{}` |

### Dashboard
| GET | `/api/sellers/dashboard` | A | `{ kpis:{totalRevenue,totalOrders,avgOrderValue,pendingOrders,completedOrders,knownRevenue,revenuePendingOrders,netEarnings,knownNetEarnings,netEarningsCalculatedOrders,netEarningsPendingOrders}, byChannel:{ecommerce:{revenue,orders},grocery:{...}}, salesPerformance:[{date,revenue}] }` |
|---|---|---|---|

### Products, stock, catalogue
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/products/seller/mine?type=<channel>&roleContext=seller` | seller role | Array or `{data}`. Product `status` is `pending\|approved\|rejected`, plus `isActive` |
| POST | `/api/products` | A | Multipart, `images` ≤ 5 files |
| PUT | `/api/products/:id` | A | Multipart, same as POST |
| DELETE | `/api/products/:id` | seller role | |
| PATCH | `/api/products/:id/stock` | A | Stock adjustment |
| PATCH | `/api/products/:id/channels` | A | Channel status |
| PATCH | `/api/products/:id/wholesale-pricing` | A | |
| POST | `/api/products/:id/digital-file` | A | Multipart `file` (PDF e-book) |
| GET | `/api/products/bulk/template?mode=` · POST `/bulk/upload?mode=` | seller/A | Bulk CSV/XLSX |
| GET | `/api/products/category-return-policy?categoryId=` | seller role | |
| GET | `/api/categories/tree?type=` | P | Category picker |

### Orders and fulfilment
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/sellers/orders?type=&status=all&limit=100` | A | `{ data:[order] }`. Only this seller's lines |
| GET | `/api/sellers/orders/:id` | A | `{ data: order }`. **`order.permittedActions[]`** = `{label,to,reject?,setup?}` decides every action button (fail closed) |
| PATCH | `/api/sellers/orders/:id/status` | A | `{ status, version, reason? , courier?, awb? }`. Server enforces transitions and payment readiness |
| GET | `/api/sellers/orders/:id/fulfillment-options` | A | Manual rider vs Shiprocket eligibility |
| POST | `/api/sellers/orders/:id/fulfillment/manual` | A | `{ riderId? }` |
| POST | `/api/sellers/orders/:id/fulfillment/shiprocket` | A | `{ confirm:true, package, quotedCourierCharge }`. **Creates a real courier shipment** |
| GET/POST | `/api/sellers/orders/:id/shiprocket-fee` · POST `/api/sellers/shiprocket-fees/verify` | A | **Payment flow (Razorpay)** |
| GET | `/api/sellers/orders/:id/financial-breakdown` | A | Amounts in **paise** (`grossPaise`, `commissionPaise`, `taxPaise`, `tcsPaise`, `tdsPaise`, `netPaise`) |
| GET | `/api/sellers/orders/:id/invoice` | A | `{ data }` invoice payload |

### Returns
| GET | `/api/sellers/returns?status=` · GET `/returns/:id` · GET `/returns/:id/pickup-options` | A |
|---|---|---|
| POST | `/returns/:id/decision` · `/assign-rider` · `/pickup` · `/pickup/refresh` · `/pickup/cancel` · `/mark-received` | A |

### Finance
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/sellers/finances/summary` | A | `data.balances{earnedEarnings,pending,held,eligible,reserved,settled,quickFreightObligations,bulkimartServiceFees,…}`, `payoutActionsEnabled`, `payouts[]`, `payoutPolicy`, `salesMetrics`, `deliveredSales`, `coverage`, `salesByChannel`. Amounts in **rupees** |
| GET | `/api/sellers/finances/ledger?limit=50` | A | `data:[{_id,amount,direction,bucket,description,reference,entryNo,createdAt}]` |
| GET | `/api/sellers/finances/tax-statement` | A | `data{months[{month,grossPaise,taxablePaise,tcsPaise,tdsPaise}],tcsRatePercent,tdsRatePercent,gstin,pan}` |
| POST | `/api/sellers/payouts` | A | `{ amount }` with header `Idempotency-Key`. Creates a **payout request** (admin pays manually) |

### Advertising (sponsored products), mounted at `/api/sellers/advertising` (A)
`GET /capabilities`, `GET /packages`, `GET /packages/:id`, `GET /products`, `GET/POST /campaigns`, `GET/PATCH /campaigns/:id`,
`POST /campaigns/:id/submit`, `POST /campaigns/:id/actions`, `POST /campaigns/:id/cancel`, `GET /campaigns/:id/billing`,
`GET /campaigns/:id/analytics`, `POST /campaigns/:id/payment-attempts`, `POST /campaigns/:id/payment-verification` (**Razorpay**).

### GST assistance, mounted at `/api/sellers/gst-assistance`
`GET /capabilities`, plus application and payment endpoints (`/payments/verify` is **Razorpay**).

### Notifications, support, FAQs
| Method | Path | Auth |
|---|---|---|
| GET | `/api/notifications?page=&limit=` → paginated; `GET /unread-count` → `data.count`; `PATCH /:id/read`; `PATCH /read-all`; `DELETE /:id` | S |
| POST | `/api/notifications/tokens` `{ token, platform, deviceId? }` (or header `x-device-id`); `DELETE /tokens/:token` | S |
| GET | `/api/tickets/categories`, `GET/POST /api/tickets` (multipart attachments), `GET /:id`, `POST /:id/messages`, `POST /:id/reopen` | S |
| GET | `/api/helpline` | P |
| GET | `/api/sellers/faqs` · PATCH `/api/sellers/faqs/:faqId/answer` | A |

### Not available for sellers (do not build)
- **Seller coupons:** `/api/coupons` only has `validate` and `available` (customer checkout). No seller coupon management exists.
- **Seller promotions / campaigns / deals:** retired (`utils/retiredFeatures.js`, `SELLER_PROMOTIONS_RETIREMENT_AUDIT.md`). Notifications for them are hidden.
- **Token refresh:** none. A single 30-day JWT (`JWT_EXPIRES_IN` default `30d`).
- `/api/analytics` is a placeholder stub.

## 3. Authentication flow

1. Phone entry → `normalizePhoneInput` (strips +91/0091/0, keeps 10 digits).
2. `POST /api/auth/seller/send-otp { phone, intent }`.
   - `login` with no account → 404 `NOT_A_MEMBER` / `SELLER_NOT_FOUND`. The UI offers "Register store".
   - `register` with an existing seller → 409 `SELLER_EXISTS`. The UI offers "Sign in".
3. `POST /api/auth/seller/verify-otp { phone, otp, intent }` → `token`, `sessionRole:'seller'`.
   **Warning:** `intent:'register'` creates a `User` document in production when the phone is new.
4. Store the token (Android Keystore through `react-native-keychain` in the app; `localStorage.sellerToken` on web).
5. Gate (identical to `frontend/src/modules/Seller/routes/index.jsx`):
   - `GET /api/auth/me`. 5xx → "verification error, retry". Not ok / `sessionRole !== 'seller'` / no `profile._id` → signed out.
   - `GET /api/sellers/me`. 401 → clear session. 404 or `seller:null` → onboarding (register intent) or "No seller account found" (login intent). 5xx → retry.
   - `seller.status`: `none|incomplete` → onboarding; `approved` → dashboard; `pending|under_review|rejected|suspended` → status gate (shows `rejectionReason`).
6. Any 401 later → clear the session and return to login. (A 403 `AUTH_ROLE_REQUIRED` is shown as an error, not a logout.)
7. Logout: deregister the push token (`DELETE /api/notifications/tokens/:token`), `POST /api/auth/logout`, clear local storage.
8. Session isolation: the Customer app (`com.Bulkimart.user`) and Seller app hold separate tokens. The server rejects customer-session tokens on seller routes (`requireSellerSession`) and seller tokens on customer routes (`requireCustomerSession`).

## 4. Module-by-module plan

| # | Module | Backend | Stage | Notes |
|---|---|---|---|---|
| 1 | Splash | — | 1 | Native splash plus a session-check screen. No onboarding carousel exists on web, so none is built |
| 2 | Login (OTP) | auth/seller | 1 | Login and register intents |
| 3 | Dashboard | `/sellers/dashboard` | 1 | KPIs, channel split, 7/30-day sales chart (react-native-svg) |
| 4–6 | Products and media | products | 2 | Biggest form (`ProductModal.jsx`, 1,307 lines: variants, wholesale tiers, GST, return policy, same-day, digital PDF). Camera/gallery picker, ≤ 5 images |
| 7 | Inventory | `/products/:id/stock` | 2 | Port `StockTab.jsx` rules |
| 8–9 | Orders and details | `/sellers/orders*` | 1 (status actions, details, finance breakdown) / 2 (fulfilment set-up, invoice) | Actions only from `permittedActions` |
| 10 | Returns | `/sellers/returns*` | 3 | Decision plus pickup flows |
| 11–14 | Wallet, commission, GST/TCS/TDS, payouts | `/sellers/finances*`, `/payouts` | 1 | Display only backend amounts, with the same shape validation as web |
| 15 | Advertising | `/sellers/advertising` | 4 | Campaign creation needs Razorpay. Payment steps stay blocked until a test-mode key and approval are in place |
| 16 | Coupons | **none** | — | Not built: no seller backend |
| 17 | Profile and business settings | `/sellers/me`, `/sellers/profile`, `/channels` | 1 (view/edit) / 3 (location pin, same-day, wholesale request) | |
| 18 | KYC and onboarding documents | `/sellers/start`, `/step/1-4`, `/submit` | 3 | Document picker, PDF/image, upload progress. Port `onboardingValidation.js` |
| 19 | Notifications | `/notifications*` | 1 (inbox) / 3 (FCM push) | |
| 20 | Support and help | `/tickets*`, `/helpline`, `/sellers/faqs` | 3 | |
| — | Services, GST assistance | `/services`, `/sellers/gst-assistance` | 4 | Web-only for now. Includes payments |

## 5. Folder structure (Stage 1 as written)

```
mobile-seller/
  App.js  index.js  app.json  package.json  babel.config.js  metro.config.js  .gitignore
  README.md  MEMORY.md  CONVERSION_CHECKLIST.md  docs/SELLER_APP_ANALYSIS.md
  src/
    config/env.js                 API base URL, timeouts
    theme/index.js                Bulkimart tokens (from frontend/src/index.css)
    services/
      storage.js                  Keychain token storage
      apiClient.js                Axios instance, auth header, 401 handling, error normalisation
      auth.api.js  seller.api.js  notifications.api.js
    context/AuthContext.js        Server-driven seller gate (mirrors web routes/index.jsx)
    navigation/RootNavigator.js  AppTabs.js
    components/                   Screen, AppButton, AppInput, Card, StateViews, StatusPill,
                                  KeyValueRow, ReasonPrompt, SalesChart, ErrorBoundary, OfflineBanner
    utils/                        format, phone, orderAmounts, financeRead, productTax (ports of web utils)
    screens/
      auth/        SplashScreen, LoginScreen, NoSellerAccountScreen, StatusGateScreen, OnboardingRequiredScreen
      dashboard/   DashboardScreen
      orders/      OrdersScreen, OrderDetailScreen, OrderFinanceSection
      finance/     EarningsScreen, PayoutRequestScreen, PayoutHistoryScreen, TaxStatementScreen
      notifications/NotificationsScreen
      profile/     ProfileScreen, EditProfileScreen, MoreScreen
  android/                        Generated in a trusted environment (see README). Not hand-written
```

## 6. Dependencies and native Android configuration

Versions follow `mobile-user/package.json` (RN 0.88.1, React 19.3.0, CLI 20.2.0). **Not installed.**
Exact versions must be confirmed with `npm view` on the rebuilt machine.

| Package | Purpose | Stage |
|---|---|---|
| react-native 0.88.1, react 19.3.0 | Core | 1 |
| @react-native-community/cli 20.2.0 (+ platform-android) | Bare CLI | 1 |
| @react-navigation/native, native-stack, bottom-tabs | Navigation | 1 |
| react-native-screens, react-native-safe-area-context | Navigation natives | 1 |
| axios | HTTP client | 1 |
| react-native-keychain | Token in Android Keystore | 1 |
| @react-native-async-storage/async-storage | Payout idempotency keys, non-sensitive prefs | 1 |
| @react-native-community/netinfo | Offline banner | 1 |
| react-native-svg | Sales chart | 1 |
| react-native-get-random-values + uuid | Idempotency-Key generation (Hermes has no `crypto.randomUUID`) | 1 |
| react-native-image-picker | Camera/gallery (products, KYC) | 2 |
| @react-native-documents/picker | PDF/image documents | 3 |
| react-native-blob-util | Downloads, invoice/PDF open, upload progress | 2 |
| react-native-share | Share files | 3 |
| @react-native-firebase/app, /messaging | FCM push | 3 |
| socket.io-client | Real-time order events (same as web) | 3 |
| react-native-razorpay | Only if advertising/shipping-fee payments are approved | 4 |

Android:
- `applicationId` / `namespace` **`com.Bulkimart.seller`**. This exact casing is already registered in Firebase project `bulkimart-d865c`, and the Customer app uses `com.Bulkimart.user`. `com.bulkimart.seller` (lowercase) would need a new Firebase registration.
- App name `Bulkimart Seller`; minSdk 24, target/compile SDK per the RN 0.88 template; Hermes on; New Architecture per template.
- Permissions, added in the stage that needs them, never requested at start-up: `INTERNET` (1), `CAMERA` (2), `POST_NOTIFICATIONS` (3, Android 13+), `ACCESS_FINE_LOCATION` (3, store pin only). Photo/document access uses the system pickers, so no storage permission is needed.
- `google-services.json` for `com.Bulkimart.seller` stays out of git (root `.gitignore` already ignores `google-services*.json`).
- `usesCleartextTraffic=false`; HTTPS API only.

## 7. Missing backend functionality and risks

1. **No seller coupon or promotion management.** Module 16 can't be built without a backend. A product decision is needed.
2. **No refresh token.** Sessions end after 30 days, and the app returns to OTP login. This matches web.
3. **`verify-otp` with `intent:'register'` writes to production.** Registration testing needs a staging API or a test number approved by you.
4. **`/api/sellers/me` returns `{seller}`, not `{data}`.** The client handles both envelopes, as web does.
5. **Push token platform value:** web sends `platform:'web'`. The backend `registerPushToken` must accept `'android'`. Verify in `services` before Stage 3; this may need a small backend change, which waits for your approval.
6. **Payment flows** (Shiprocket fee, advertising, GST assistance) use Razorpay. They stay blocked until a test-mode key and explicit approval are in place.
7. **Invoices:** the web renders invoice HTML from `/orders/:id/invoice` and prints it. Native printing or PDF export needs a library choice in Stage 2.
8. **Dev-environment security:** this machine has an active PolinRider infection history. No install, build or run should happen until the OS is rebuilt.
