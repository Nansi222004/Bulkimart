# Seller/customer session isolation

## Confirmed root cause

`forntend/src/modules/Seller/context/SellerContext.jsx::verifyOtpAndLogin` wrote the seller OTP response into `userToken` and `userProfile`, the exact localStorage keys used by `UserContext` and `CustomerSessionGate`. This replaced the authenticated customer principal, rather than merely changing display text. Seller sign-out and expired-session paths also removed those customer keys.

`CustomerSessionGate` accepted a server-verified `seller` session if its profile also held buyer membership. Seller registration deliberately creates buyer/seller accounts, so this check admitted the overwritten seller identity to `/account`. Customer fetches then correctly requested the identity belonging to the wrong token. `/api/auth/me` itself selects the identity from the verified JWT; it does not select a user from a browser-provided phone number.

The backend already signs distinct buyer/seller entry-point roles. The fix keeps that model and gives the two portals independent browser credential slots. It does not create a new authentication provider, alter OTP verification or fabricate profile data.

## Session policy implemented

| Portal | Credential | Cached profile | Same-tab event |
| --- | --- | --- | --- |
| Customer/existing Delivery flow | `userToken` | `userProfile` | existing `bulkimart:session-changed` |
| Seller | `sellerToken` | `sellerUserProfile` | `bulkimart:seller-session-changed` |

Seller requests never fall back to customer or generic `token` keys. Customer login/logout leaves the seller session intact; seller login/logout leaves the customer session intact. Customer/Delivery transitions retain their existing explicit flow. Signed role claims and live backend ownership/approval checks remain authoritative.

Seller restoration verifies `/api/auth/me` and its seller role before admitting the dashboard. Cached seller identity is refreshed from authenticated responses. Token changes invalidate pending details, and replacing an existing seller remounts account-specific React state. The initial guest-to-seller transition preserves onboarding intent. Customer restoration retains its existing generation/token checks; seller-role responses now fail closed even when buyer membership exists. Seller storage events do not trigger customer profile replacement.

Customer profile/address/cart/order/wallet routes reject seller-role tokens. Seller routes reject explicitly signed buyer/Delivery sessions. Existing legacy tokens without an entry-point role retain compatibility through existing membership/ownership checks. Seller account profile editing uses `/api/sellers/account-profile` (GET/PUT), reusing the existing authenticated profile controllers instead of opening the customer endpoint.

Shared notification, support, service and push helpers select the active portal's credential. Push registration state and stored token references are scoped per portal so logout and pending registration do not use the other portal's credentials. The existing Firebase app/service worker and backend token-ownership policy remain unchanged. Genuine concurrent Web Push delivery across two portal accounts is not verified; the existing backend associates a device token with one account at a time. HTTP profile/session isolation does not depend on push.

## Files changed for this fix

| Files | Purpose |
| --- | --- |
| `backend/controllers/auth.controller.js` | Return the already-signed seller session role explicitly in seller OTP responses |
| `backend/middlewares/auth.middleware.js` | Add customer/seller entry-point guards without weakening JWT or live authorization |
| `backend/routes/user.routes.js`, `backend/routes/cart.routes.js`, `backend/routes/order.routes.js`, `backend/routes/wallet.routes.js` | Enforce customer session boundaries |
| `backend/routes/seller.routes.js` | Enforce seller entry-point boundary; reuse profile controllers through seller account-profile routes |
| `backend/__tests__/api/delivery-login-role.http.test.js`, `backend/__tests__/api/cart.api.test.js` | Cross-role regressions; make cart customer fixtures explicitly hold buyer membership |
| `backend/scripts/verifySellerNotificationsBrowser.mjs` | Isolated browser login, navigation, refresh, simultaneous tabs, API isolation and logout regression |
| `forntend/src/utils/portalSession.js` | Portal credential selection and validated seller session persistence |
| `forntend/src/components/CustomerSessionGate.jsx` | Reject seller sessions on customer routes |
| `forntend/src/modules/Seller/context/SellerContext.jsx`, `forntend/src/modules/Seller/routes/index.jsx` | Separate login/logout, restoration, cross-tab state and seller API headers |
| `forntend/src/modules/Seller/components/BulkUploadModal.jsx`, `forntend/src/modules/Seller/components/FaqsTab.jsx`, `forntend/src/modules/Seller/components/ProductModal.jsx`, `forntend/src/modules/Seller/components/ProfileTab.jsx` | Use seller credentials for uploads, products, FAQs and profile editing |
| `forntend/src/modules/Seller/components/SellerCampaignsTab.jsx`, `forntend/src/modules/Seller/components/SellerPromotionsTab.jsx`, `forntend/src/modules/Seller/components/SellerReturnsTab.jsx`, `forntend/src/modules/Seller/components/SellerOrderRingModal.jsx`, `forntend/src/modules/Seller/components/SellerOrderAlerts.jsx` | Bind seller workflows/alerts to seller credentials |
| `forntend/src/utils/useNotifications.js`, `forntend/src/utils/useTickets.js`, `forntend/src/utils/firebaseMessaging.js`, `forntend/src/components/NotificationPopup.jsx`, `forntend/src/components/services/ServicesPanel.jsx` | Bind shared API requests and registration to the proper portal |
| `forntend/scripts/auth-role.test.mjs`, `forntend/scripts/seller-notifications.test.mjs`, `forntend/scripts/mobile-layout.test.mjs` | Isolation regressions and separate seller fixture credentials |
| `SELLER_CUSTOMER_SESSION_ISOLATION.md` | Findings, policy, verification and rollout notes |

## Verification

- Focused backend authentication/cart tests: `npm test -- --runInBand __tests__/api/cart.api.test.js __tests__/api/delivery-login-role.http.test.js __tests__/api/seller-phone-auth.http.test.js` — 3 suites, 49 passed, 0 failed.
- Full backend: `npm test -- --runInBand` — 50 suites passed, 410 tests passed, 7 skipped, 0 failed (417 total). Includes checkout, seller workflows, e-books, authentication and marketplace regressions.
- Frontend: `node --test --test-concurrency=1 scripts/auth-role.test.mjs scripts/seller-notifications.test.mjs scripts/checkout-ui.test.mjs scripts/socket-ui.test.mjs scripts/service-ui.test.mjs scripts/image-search-ui.test.mjs` — 97 passed, 0 failed, 0 skipped.
- Backend `npm run build` passed, including backend-only service package verification.
- Frontend `npm run build` passed; existing large-chunk warning remains (main JS approximately 1.70 MB minified). Neither package defines a lint script.
- Headless Chrome at 390px against the production build: seller login/dashboard/Orders/Products layout checks passed (4 pages, no application errors).
- `cd backend; node scripts/verifySellerNotificationsBrowser.mjs` passed with real Express/Mongoose/JWT/Socket.IO paths and a disposable local replica set. Both customer and seller OTP forms were exercised in headless Chrome at 390x844. Verified separate stored identities, seller login while the customer remains signed in, two simultaneous portal tabs, customer navigation/refresh, seller deep-link refresh, customer profile/address/wallet/order API access and seller-token rejection, and seller logout without clearing either customer tab. The existing notification popup, read state, order details and deduplication checks also passed. OTP and FCM delivery were mocked; no Atlas writes occurred.
- `git diff --check` passed, with line-ending notices only.

Initial expanded backend tests exposed cart fixtures without buyer membership; those fixtures now reflect a valid customer login. A new test callback typo was also corrected. The final complete backend run passed. An initial browser run failed an account-stage assertion; the final regression uses the actual account profile element and checks a separate tab rather than using arbitrary page text as readiness evidence.

## Rollout and limitations

Existing seller sessions must sign in again to populate the new seller keys. If the old seller login already overwrote a customer's token, the original credential cannot be reconstructed safely: that customer must sign in again. Do not copy cached profiles or infer the original identity from a phone number. Seller credentials found in the old customer slot are rejected by server-verified role restoration.

No production users/data, Atlas indexes, payment credentials or checkout financial logic were changed. Existing unrelated dirty changes were preserved. No deployment or production release was performed. The existing logout endpoint is stateless; JWT expiry/revocation behavior was inspected and not replaced with a new session store.

Real Android/iOS devices, production accounts and actual Web Push delivery were not tested. Browser verification uses disposable local accounts, mock OTP/push and a local replica-set database, never the reported real accounts or Atlas.
