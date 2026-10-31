# Bulkimart Customer App — Conversion Checklist

Tracks every in-scope screen, API and capability of the web Customer app and its status in the native app.
Statuses: **Verified** (run and seen working) · **Built, not tested** (code written, needs device/test-account check) · **Blocked** (cannot finish; reason given) · **Pending** (not yet converted).

## 0. Discovered inputs

| Input | Value | Source |
|---|---|---|
| Target app | Customer/User app (role `buyer`) | User instruction; `frontend/src/App.jsx` routes every non-`/seller`, `/admin`, `/delivery` path to `modules/User` behind `CustomerSessionGate` |
| Web frontend | `frontend/` (React 19 + Vite, no router library; `modules/User/context/UserContext.jsx` drives navigation from `window.location`) | repo |
| Backend | `backend/` (Express + MongoDB, JWT bearer auth) | repo |
| Shared code | `backend/shared/storefront.mjs`, `backend/shared/celebration.mjs` (imported by the web), `shared/serviceLimits.mjs` | repo |
| Flutter wrapper | **None in repo.** Confirmed absent (repo, git history, sibling folders). User confirmed the absence is intentional. | user instruction |
| App name | `Bulkimart` | user instruction; web `<title>` "Bulkimart — Sabse Smart Bulkimart" |
| Android package | `com.Bulkimart.user` — **already registered** as the user app in Firebase project `bulkimart-d865c` | untracked `google-services (2).json` at repo root (contains `com.Bulkimart.user`, `com.Bulkimart.seller`, `com.Bulkimart.delivery`). **Needs user confirmation before release build.** |
| Version | `1.0.0` / versionCode `1` (assumption: no earlier Android release config exists) | no wrapper; `frontend/package.json` is `0.0.0` |
| API base URL | `https://api.bulkimart.in` (health `GET /api/health` → 200 "Backend is running") | `frontend/.env.production` `VITE_API_BASE_URL`; user instruction |
| Socket.IO origin | `https://api.bulkimart.in` (same host as HTTP) | `frontend/src/utils/socket.js` |
| Website (visual reference) | `https://bulkimart.in` | `backend/config/cors.js` PRODUCTION_ORIGINS |
| Firebase (push) | project `bulkimart-d865c`, sender `491974533047`; Android client for `com.Bulkimart.user` present | `google-services (2).json`; `frontend/.env` `VITE_FIREBASE_*`; backend service account project id matches |
| Google Maps key | Browser key present as `VITE_GOOGLE_MAPS_API_KEY` | `frontend/.env` (public client key; must have *Maps SDK for Android* enabled and allow package + SHA-1) |
| Razorpay key | Not stored in frontend; `POST /api/payments/initiate` returns `keyId` at runtime | `frontend/src/utils/razorpayCheckout.js` |
| App icon / logo | `frontend/src/assets/logo-icon-transparent.png` (header/launch icon), `Glossy Aqua Bulkimart Shopping Logo.png` (favicon), `Bulkimart-logo-transparent.png` | `frontend/index.html`, `PromotionalSplash.jsx`, `UnifiedHeader.jsx` |
| Launch screen | Web `index.html` boot screen: logo on a white 104px tile over the theme header colour (default `#79000B`) | `frontend/index.html` `.boot-home` |
| Test login | **Not available.** Production OTP is "live" (no mock); `send-otp` was not exercised against production (blocked as a real-world action). Local backend `.env` points at the shared Atlas `bulkimart` DB, so creating users locally would write to the shared DB — not done. | `backend/services/sms.service.js`, `backend/config/runtime.js`, `backend/.env` (host only inspected) |
| Expo account | Not logged in (`npx eas-cli whoami` → "Not logged in") | command |

## 1. Precondition audit

1. Frontend source — present (`frontend/src`). ✅
2. Backend source — present (`backend/`). ✅
3. Production API health — `https://api.bulkimart.in/api/health` → 200. ✅
4. Frontend env — `frontend/.env`, `.env.production`, `.env.development`: API base URL, Firebase web config, VAPID key, Google Maps key. ✅
5. Backend env — `backend/.env` (read for modes/hosts only; no secrets copied). Local copy: `NODE_ENV=development`, `OTP_MODE=mock`, `RAZORPAY_MODE=test`; production refuses mocks on live hosts. ✅
6. Customer auth — phone + 4-digit OTP (`/api/auth/send-otp`, `/api/auth/verify-otp`), JWT returned in body, sent as `Authorization: Bearer`. No refresh endpoint. ✅
7. OTP / test login — production has no bypass OTP; no test customer exists. **Authenticated checks are "Built, not tested".**
8. Firebase / push — present and consistent (see §0). ✅
9. Google Maps — browser key present; Android usage needs key restrictions updated (see Known issues).
10. Payment gateway — Razorpay via backend-issued checkout data. Production uses live mode → no real payment may be triggered in testing.
11. Expo CLI / EAS — Expo CLI works (SDK 58); EAS not logged in.
12. Branding assets — present in `frontend/src/assets` and `frontend/public`.
13. Package name — `com.Bulkimart.user` found in Firebase config (see §0).

## 2. Customer routes / screens and guards

Web routing: `App.jsx` → `CustomerSessionGate` (verifies stored token with `GET /api/auth/me`; requires `userType=user`, `sessionRole=buyer`, `profile.roles` includes `buyer`) → `LandingPage` (single shell; `activeNav` from path). Protected navs (`account`, `checkout`, `orders`, `ebooks`, `wishlist`) render `AuthPage` for guests (`LandingPage.jsx` `protectedNavItems`).

| # | Web route / state | Web file | Guard | Native route / file | Status |
|---|---|---|---|---|---|
| 1 | `/` home (Quick / ShopAll) + sub-nav tabs | `LandingPage.jsx`, `UnifiedHeader.jsx`, sections | public | `app/index` → `HomeScreen` | Built, not tested |
| 2 | Promotional splash (Storefront Studio) | `PromotionalSplash.jsx`, `SplashCard.jsx` | public, home launch | `components/storefront/PromotionalSplash` (root overlay) | Built, not tested |
| 3 | `/search` + voice + image search | `SearchPage.jsx`, `VoiceSearchModal.jsx`, `ImageSearchSheet.jsx` | public | `app/search` | Built, not tested |
| 4 | `/categories[/:slug]` | `CategoriesPage.jsx` | public | `app/categories` | Built, not tested |
| 5 | Product detail (+ wholesale offer) | `ProductDetailPage.jsx`, `ProductWholesaleOffer.jsx` | public | `app/product?id&purchase&variant` | Built, not tested |
| 6 | `/cart` (unified basket) | `CartPage.jsx`, `BasketGroups.jsx`, `CartUI.jsx` | public; actions need sign-in | `app/cart` | Built, not tested |
| 7 | `/checkout` (all modes, COD/online/wallet, tip, recovery) | `CheckoutPage.jsx`, `CommittedCheckoutReview.jsx` | protected | `app/checkout` | Built, not tested |
| 8 | `/orders` | `OrdersPage.jsx` | protected | `app/orders` | Built, not tested |
| 9 | `/orders/:id` tracking (map, OTP, courier AWB, returns, rating, invoices) | `OrderTrackingPage.jsx`, `DeliveryMap.jsx`, `DeliveryPartnerRating.jsx`, `OrderInvoices.jsx` | protected | `app/order/[id]` → `OrderTrackingScreen` | Built, not tested |
| 10 | `/review/:productId` | `WriteReviewPage.jsx` | protected | `app/review/[id]` → `WriteReviewScreen` | Built, not tested |
| 11 | `/account` (profile, wallet + top-up, addresses, support tickets, privacy, logout, delete) | `ProfilePage.jsx`, `TicketDetailModal.jsx`, `useTickets`, `useCustomerWallet` | protected | `app/account[?section=wallet]` → `ProfileScreen` | Built, not tested |
| 12 | `/wishlist` | `WishlistPage.jsx` | protected | `app/wishlist` | Built, not tested |
| 13 | `/ebooks` | `DigitalLibraryPage.jsx` | protected | `app/ebooks` → `EbooksScreen` | Built, not tested |
| 14 | `/wholesale`, `/wholesale/cart` | `WholesalePage.jsx`, `WholesaleCartPage.jsx` | public browse | `app/wholesale`, `app/wholesale-cart` (→ cart, Wholesale group) | Built, not tested |
| 15 | `/services` | `CustomerServices.jsx` | public | `app/services` | Built, not tested |
| 16 | `/legal-services[/:id]`, `/legal-services/requests[/:id]` (form, fee payment, follow-up, private files) | `LegalServices.jsx`, `ServicesPanel.DynamicFields`, `ServicePaymentPanel.jsx` | browse public; requests need sign-in | `app/legal-services?view=requests&id=` | Built, not tested |
| 17 | `/parcel-delivery[/book|/history|/track/:id]` | `ParcelDelivery.jsx`, `ParcelBookingFlow.jsx`, `ParcelLocationPicker.jsx`, `ParcelMap.jsx`, `ParcelCustomerStatus.jsx` | sign-in required | `app/parcel-delivery?view=book|history|track&id=` | Built, not tested |
| 18 | Campaign landing | `CampaignLandingPage.jsx` | public | `app/campaign/[id]` | Built, not tested |
| 19 | Auth (sign in / register, OTP, terms) | `AuthPage.jsx`, `RegistrationTerms.jsx` | — | `screens/AuthPage` (shown by protected pages) | Built, not tested |
| 20 | Location prompt / picker + landmark photo | `LocationPromptModal.jsx`, `LandmarkImagePicker.jsx` | public | modal + component | Built, not tested |
| 21 | Notification drawer | `NotificationDrawer.jsx`, `useNotifications` | signed-in | modal | Built, not tested |
| 22 | Exit confirmation on Home back | `LandingPage.jsx` | — | BackHandler in `HomeScreen` | Built, not tested |
| 23 | Coupon celebration + threshold progress | `CouponSuccessCelebration.jsx`, `CouponThresholdProgress.jsx` | — | components | Built, not tested |
| 24 | Pull-to-refresh | `PullToRefresh.jsx`, `refreshRegistry.js` | — | `RefreshControl` + `lib/refresh` | Built, not tested |
| 25 | Floating cart bar | `LandingPage.jsx` | — | `Shell.FloatingCartBar` | Built, not tested |
| 26 | Realtime notice | `RealtimeNotice.jsx` | signed-in | `Shell.RealtimeNotice` | Built, not tested |
| 27 | Sponsored category blocks | `SponsoredCategoryBlock.jsx` | public | `HomeSections.SponsoredCategoryBlock` | Built, not tested |

All 27 compile into the Android bundle (`npx expo export --platform android`, Verified) and pass lint. None has been run on a device or emulator yet (none connected), so none is marked Verified.

## 3. Excluded (other roles / desktop-only)

| Area | Reason |
|---|---|
| `/admin/*` (`modules/Admin`, admin parts of `components/services`, `parcels/ParcelAdminPanel`, `ParcelPolicyEditor`, `advertising/*` workspace/billing/builder) | Admin panel — stays on web |
| `/seller/*` (`modules/Seller`, `gst/*`, seller advertising, seller finance) | Seller app — separate role |
| `/delivery/*` (`modules/Delivery`, `parcels/ParcelRiderInbox`, `ParcelOperations`) | Delivery partner app — separate role |
| `modules/FigmaStudio` | Internal design tool |
| Desktop-only layouts (`header-search-row--desktop`, `.boot-home` desktop spinner, desktop gutters) | Mobile layout built only |

## 4. API inventory (customer)

All paths relative to `https://api.bulkimart.in`. Auth = `Authorization: Bearer <userToken>`. Response envelope: `{ success, data, message }` unless noted.

| Area | Method & path | Payload / query | Response (used fields) | Status |
|---|---|---|---|---|
| Auth | POST `/api/auth/send-otp` | `{ phone, isLogin }` | `{ success, message, otp? (mock only) }` | Built, not tested |
| Auth | POST `/api/auth/verify-otp` | `{ phone, otp, isLogin, name, email }` | `{ success, isNewUser, sessionRole, token, user }` | Built, not tested |
| Auth | GET `/api/auth/me` (auth) | — | `{ success, userType, sessionRole, profile }` | Built, not tested |
| Profile | GET / PUT `/api/users/profile` (auth) | `{ name, email }` | `{ user }` | Built, not tested |
| Addresses | GET / POST `/api/users/addresses`; PUT / DELETE `/api/users/addresses/:id`; PUT `/api/users/addresses/:id/default`; POST `/api/users/addresses/upload-landmark` (multipart `image`) | address fields incl. `lat,lng,locationSource,isDefault,placeName,landmarkImage` | `data[]` / `data.addressId` / `imageUrl` | Built, not tested |
| Geo | GET `/api/geo/reverse?lat&lng&accuracy`, GET `/api/geo/forward?q` (auth) | — | `data{address,city,state,pincode,placeName}` / `data{lat,lng}` | Built, not tested |
| Storefront | GET `/api/storefront/experience?scope&device&category` | — | `data{theme,banners,headerCategories,sections,splash,announcement,animations,version,serverTime,validUntil,scheduleUntil}` | Built, not tested |
| Banners | POST `/api/banners/:id/click` | — | — | Built, not tested |
| Campaigns | GET `/api/campaigns/:id`, `/api/campaigns/:id/products[?type]` | — | campaign, `products[]` | Built, not tested |
| Catalogue | GET `/api/products?…` (type, category, featured, maxPrice, limit, page, sort…), `/api/products/:id`, `/api/products/featured?type`, `/api/products/search?q&type`, `/api/products/:id/reviews`, `/api/products/:id/faqs`, `/api/products/reviews/mine?productIds` (auth), POST `/api/products/:id/reviews` (auth, multipart photos) | — | product shapes (see `hooks/useProducts.normalizeProduct`) | Built, not tested |
| Delivery options | GET `/api/products/:id/delivery-options?lat&lng…`, POST `/api/products/delivery-options` | — | same-day / scheduled availability | Built, not tested |
| Image search | GET `/api/products/search-by-image/config`, POST `/api/products/search-by-image?type&page&limit` (multipart image) | — | `data[]` | Built, not tested |
| Wholesale | GET `/api/products/wholesale/availability`, `/api/products/wholesale/catalog?…`, POST `/api/products/wholesale/quote`, GET/POST/PUT/DELETE `/api/cart/wholesale…` | — | catalog/quote/cart | Built, not tested |
| Categories | GET `/api/categories/tree?type`, `/api/categories?showOnHome=true&type` | — | tree | Built, not tested |
| Sellers | GET `/api/sellers/public/:id` | — | public seller profile | Built, not tested |
| Advertising | GET `/api/advertising/placements?…` | — | sponsored placements | Built, not tested |
| Cart | GET `/api/cart?channel&coupon&lat&lng&deliveryMode&preserveUnavailable`, GET `/api/cart/summary`, GET `/api/cart/unified?…`, POST `/api/cart` `{productId,qty,variantId}`, PUT `/api/cart/:itemId` `{qty}`, DELETE `/api/cart/:itemId`, DELETE `/api/cart?channel`, PUT `/api/cart/items/:itemId/message` | — | `data{items,count,pricing,warnings,channel,appliedCoupon,couponError,couponSavings}` | Built, not tested |
| Coupons | GET `/api/coupons/available?channel`, POST `/api/coupons/validate` `{code,channel}` | — | offers / `{valid,reason}` | Built, not tested |
| Tip | GET `/api/tip-setting` (+ socket `tip_setting_updated`) | — | tip config | Built, not tested |
| Orders | POST `/api/orders` (Idempotency-Key), POST `/api/orders/unified`, POST `/api/orders/checkout-status`, GET `/api/orders?limit=50`, GET `/api/orders/:id`, GET `/api/orders/:id/track`, PATCH `/api/orders/:id/cancel`, POST `/api/orders/:id/abandon-payment`, GET `/api/orders/:id/invoices`, GET `/api/orders/:id/items/:itemId/return-eligibility`, POST `/api/orders/:id/delivery-rating` | see `UserContext.placeOrder` | `data{order|orders,payment,groupRef}` | Built, not tested |
| Payments | POST `/api/payments/initiate` `{orderId}` → Razorpay checkout data; POST `/api/payments/razorpay/verify` (and service/wallet/parcel verify paths); GET `/api/payments/:orderId/status` | — | `data{provider,keyId,razorpayOrderId,amountPaise,…}` | Built, not tested |
| Returns | GET `/api/returns?orderId`, POST `/api/returns` (multipart) | — | returns | Built, not tested |
| Digital | POST `/api/digital/checkout`, GET `/api/digital/library`, GET `/api/digital/library/:id/download[?inline=1]` | — | library entries / file | Built, not tested |
| Wallet | GET `/api/wallet`, GET `/api/wallet/transactions?limit=20`, POST `/api/wallet/topup/initiate` (+ `/api/wallet/topup/verify`) | — | balance, transactions | Built, not tested |
| Wishlist | GET `/api/wishlist`, POST/DELETE `/api/wishlist/:productId` | — | `data{items,productIds}` | Built, not tested |
| Notifications | GET `/api/notifications?page=`, GET `/api/notifications/unread-count`, PATCH `/api/notifications/:id/read`, PATCH `/api/notifications/read-all`, POST `/api/notifications/tokens` `{token,platform}` (+`X-Device-Id`), DELETE `/api/notifications/tokens/:token` | — | list / count | Built, not tested |
| Support | GET `/api/tickets?limit=50`, GET `/api/tickets/categories`, POST `/api/tickets`, GET `/api/tickets/:id`, POST `/api/tickets/:id/messages`, POST `/api/tickets/:id/reopen` | multipart attachments | tickets | Built, not tested |
| Policies | GET `/api/privacy-policy/:slug` (`user-policy`, `seller-policy`, …) | — | policy sections | Built, not tested |
| Customer services | GET `/api/customer-services[?q&page]`, `/api/customer-services/capabilities`, `/api/customer-services/catalogue/:id`, POST `/api/customer-services/catalogue/:id/applications`, GET `/api/customer-services/applications[/:id]`, payments verify | — | catalogue / applications | Built, not tested |
| Legal services | via `services/LegalServices.jsx` (`/api/…legal…`) | — | — | Built, not tested |
| Parcel delivery | `/api/parcel-delivery/*` (quote, book, history, track, payments verify) | — | — | Built, not tested |
| Realtime | Socket.IO (`join_user`): `order_status_updated`, `rider_assigned`, `delivery_status_updated`, `location_update`, `otp_ready`, `return_pickup_otp_ready`, `order_delivered`, `notification_new`, `tip_setting_updated` | `auth: { token }` | — | Built, not tested |

## 5. Authentication (backend contract)

- Login: OTP only. `send-otp` then `verify-otp` → `{ token, user, sessionRole:'buyer' }`. Registration = same with `isLogin:false` + `name`, `email`, and terms consent (client-side).
- Token: JWT, sent as `Authorization: Bearer <token>`. Expiry from `JWT_EXPIRES_IN` (server). **No refresh endpoint.** Web stores it in `localStorage.userToken` + `userProfile`.
- Session restore: `GET /api/auth/me`; 401/403 → clear session; must be `userType:'user'`, `sessionRole:'buyer'`, `profile.roles` ⊇ `buyer`; `delivery` sessions are moved out of the customer app; `seller` sessions rejected.
- Logout: `POST /api/auth/logout` exists but the web does not call it; web deregisters push token (`DELETE /api/notifications/tokens/:token`), clears storage, disconnects socket.
- Expiry: any 401 on cart load clears the session (web `refreshCart`); other screens show their error state.

## 6. State management & data fetching (web)

- React Context only: `UserContext` (navigation, auth, cart, coupons, addresses, wallet, orders, wishlist, socket events, checkout), `StorefrontContext` (Storefront Studio experience, 1 s clock, refresh before `validUntil`), `CustomerSessionContext`.
- Plain `fetch` with `boundedFetch` (10 s timeout) and `portalRequest` (de-duplicated GET with short cache).
- Hooks with module caches: `useProducts` (`clearCatalogCache`), `useCategoryTree` (`clearCategoryCache`), `useDeliveryOptions`, `useProductWholesale`, `useUnifiedCart`, `useCustomerWallet`, `useWholesaleRecommendations`.
- Polling: orders every 15 s while the Orders view/order tracking is open; storefront refresh before expiry (≤30 s; 5 s on failure).
- Pull-to-refresh runs the current page's registered handler.

## 7. Design tokens, components, assets

- Web root tokens (`frontend/src/index.css`): aqua `#08b9e8` / `#078ccb`, deep blue `#073b78`, orange `#ff8500` / `#f36b00`, text `#172b4d` / `#64748b` / `#94a3b8`, border `#e2e8f0`, radii 8/14/20, soft shadows. Fonts: Outfit, Inter (Google Fonts).
- Storefront Studio tokens (`backend/shared/storefront.mjs` `DEFAULT_TOKENS` + published theme) override the customer shell at runtime (`themeStyle`). Live theme at audit time: header `#073b78`, action `#813e14`, background `#f3f9fc`.
- Shared components: header (`UnifiedHeader`), `BottomNav`, product cards (`CategoryProductCard`, `MerchandisingCard`), `WishlistHeartButton`, feedback toasts/dialogs (`feedback/FeedbackProvider`), `ModalPortal`, `PageErrorBoundary`, `AttachmentPreview`.
- Assets reused: `logo-icon-transparent.png`, `Bulkimart-logo-transparent.png`, `banner1.webp` (default hero), category/fashion/product artwork in `frontend/src/assets`.

## 8. Web-only APIs and native replacements

| Web | Where | Native |
|---|---|---|
| `localStorage` token/profile | `userSession.js` | SecureStore (token), AsyncStorage (profile, preferences) |
| `localStorage`/`sessionStorage` caches, flags | storefront, location, checkout keys | AsyncStorage (persistent) / in-memory (session) |
| `window.history` routing | `UserContext` | Expo Router |
| CSS / inline styles | all | StyleSheet + `src/theme` built from web + storefront tokens |
| Canvas 2D celebration renderer | `celebrationRenderer.js` | react-native-svg particle renderer (same presets/parameters) |
| `<video>` banners | `StorefrontMedia.jsx` | expo-video |
| Razorpay checkout.js | `razorpayCheckout.js` | Official native SDK `react-native-razorpay` (no WebView); result verified by the same backend verify endpoints |
| Firebase web messaging + service worker | `firebaseMessaging.js` | expo-notifications (FCM device token → same backend endpoint) |
| `navigator.geolocation` | location modal, pickers | expo-location (foreground, on demand) |
| Google Maps JS | `DeliveryMap.jsx`, `ParcelMap.jsx`, parcel place search | react-native-maps (Google provider). Order route = backend `track.route.polyline` (web asks Google Directions in the browser). Parcel address search = backend `/api/geo/forward` ("Find address"); the web's Places type-ahead is not available in the app |
| `webkitSpeechRecognition` | `VoiceSearchModal.jsx` | expo-speech-recognition |
| `<input type=file>` | review photos, image search, landmark, tickets, returns, services | expo-image-picker / expo-document-picker |
| Canvas image resize | `reviewPhoto.js` | expo-image-manipulator |
| Blob download / inline PDF | e-books, invoices, private service files | expo-file-system download with the session token → system PDF viewer (expo-intent-launcher) or share/save sheet; folder picker for e-book download; invoices via expo-print |
| `window.open` external URL | promotion `EXTERNAL_URL` | `Linking.openURL` (https only) |
| Notification sound (WebAudio) | `notificationSoundManager.js` | system notification sound |

## 9. Push notifications and deep links

- Web push: Firebase Web Messaging; token registered via `POST /api/notifications/tokens` with `platform:'web'`; removed on logout. Backend sends `notification`+`data` to non-web tokens (`services/fcm.service.js`), so native FCM tokens (`platform:'android'` → stored as `app`) need **no backend change**.
- Notification click routing: `frontend/public/notification-routing.js` (orders → `/orders`).
- Deep links: none configured for the web customer app beyond URLs; Android scheme `bulkimart` added for notification routing only.

## 10. Location, camera, files, payments

- Location: location prompt (GPS or manual), address pin, delivery options, parcel pickup/drop.
- Camera/gallery: image search, review photos (≤4, resized to ≤192 KB each), landmark image, support attachments, return evidence, service documents.
- Downloads: e-book download/read, order invoices.
- Payments: Razorpay (orders, wallet top-up, customer services, parcel delivery); COD; wallet.

## 11. Features needing unavailable credentials / blocked items

| Feature | Need | Status |
|---|---|---|
| Release APK (EAS) | `eas login`, confirmation of package `com.Bulkimart.user`, and your go-ahead | **Blocked** until you act — not run |
| Maps (order tracking, parcel pins) | `GOOGLE_MAPS_ANDROID_API_KEY` set at build time; key must allow *Maps SDK for Android* + package + EAS SHA-1 | Built, not tested. Without the key the app shows "Map unavailable"; search and GPS still work |
| All signed-in flows (orders, checkout, wallet, tickets, returns, services, parcels, reviews) | A test customer account or a mock-OTP backend that is not production | Built, not tested — production OTP/login was deliberately not called |
| Payments (Razorpay) | Test-mode keys on a non-production backend | Built, not tested — no real payment triggered |
| Push notifications | Device with Google Play services + signed-in customer | Built, not tested (Firebase config is valid for `com.Bulkimart.user`) |
| Parcel address type-ahead | Browser Google Places SDK | Not available natively; replaced by backend "Find address" + GPS + map pin |
| "Become a Seller / Your Shop" | Seller portal is out of scope | Opens `https://bulkimart.in/seller` in the browser |

## 12. Checks run (this machine, 2026-10-31)

| Check | Result |
|---|---|
| `npx expo lint` | **Verified** — 0 errors, 8 warnings (intentional ref-cleanup warnings) |
| `npx expo-doctor` | **Verified** — 20/20 checks passed |
| `npm run check:shared` (storefront, celebration and service-limit rules vs backend) | **Verified** — copies match |
| `npx expo export --platform android` | **Verified** — Hermes bundle built (6.5 MB) |
| Public API reads against production (GET only, no sign-in): `/api/health`, `/api/storefront/experience`, `/api/products/wholesale/catalog`, `/api/customer-services/capabilities`, `/api/customer-services`, `/api/parcel-delivery/capabilities`, `/api/privacy-policy/user-policy` | **Verified** — 200; response shapes match what the screens validate |
| Protected endpoints without a token (`/api/digital/library`, `/api/wallet`, `/api/tickets/categories`) | **Verified** — 401, which the app treats as "sign in" |
| Local debug APK (`expo prebuild` + `gradlew assembleDebug`) | Prebuild **Verified**; Gradle **failed** (Windows path length) — see §13 |
| On-device run | **Not done** — no emulator or phone connected |

## 13. Local Android build

- `npx expo prebuild --platform android` — **Verified** (native project generated, config plugins applied).
- `gradlew assembleDebug` — **Failed on this Windows machine** after 25 min (410 tasks run): `react-native-worklets` native compile hit the Windows 260-character path limit (`ninja: mkdir(...CMakeFiles/worklets.dir/D_/Appzeto_Projects/...): No such file or directory`). This is a local-path limitation, not an app error; EAS builds run on Linux and are not affected.
- To build locally on Windows: move the project to a short path (e.g. `C:m`) or enable Windows long paths, then run `npx expo run:android`.
- Minor: prebuild noted `userInterfaceStyle` needs `expo-system-ui`; without it the app keeps the light theme it is styled for.

## 14. Device test list (to run on a phone)

1. Cold start: minimal launch screen → promotional splash from Storefront Studio (when one is live) → Home. No hard-coded promo.
2. Home: Quick / ShopAll switch, sub-nav tabs; Android back steps through tabs, then asks "Exit Bulkimart?". Pull to refresh.
3. Search: text, voice (microphone permission asked only on tap), image search (camera/gallery).
4. Categories, product detail, variants, offers sheet, wishlist heart, add to cart.
5. Sign in with OTP. Session survives an app restart; a 401 signs out.
6. Cart → checkout: address + GPS, coupons, tip, COD / wallet / Razorpay (test keys only). Server totals shown, never recomputed.
7. Orders → tracking: live status, map (needs Maps key), delivery code, courier AWB link, return with photos, invoice print/save, rider rating, review.
8. Account: avatar picker, wallet + top-up, addresses (add/delete/set active), support ticket with attachments + chat, privacy policy, logout, delete account (throwaway account only).
9. Wishlist; E-books (view in PDF app, download to a chosen folder); Wholesale catalogue, filters, paging; Campaign page.
10. Services / Legal services: browse, form with file fields, fee payment, follow-up, private document download.
11. Parcel delivery: locations (search / GPS / pin), details, quote, terms, booking, payment, tracking, history, cancel.
12. Push: a notification arrives only for the signed-in customer; tapping it opens the right screen.
13. Offline: airplane mode shows the offline message and Retry; no crash.

## 15. Device setup status — React Native CLI (2026-10-31)

| Item | Status |
|---|---|
| Workflow | React Native CLI 20.2.0 (no EAS/Expo Go/dev-client) |
| Laptop security | npm malware found and quarantined; official Node 24.19.0 / npm 11.17.0 verified; Defender full scan started (result not yet seen) |
| Dependencies | `npm ci` from lockfile with official npm — 931 packages |
| Lint / shared rules | **Verified** — 0 errors (8 warnings) / copies match backend |
| Windows long paths + CMake 3.31.6 | **Verified** — enabled; required for the C++ build |
| Debug APK (`gradlew assembleDebug`, arm64) | **Verified** — built in 17 min, `android/app/build/outputs/apk/debug/app-debug.apk` (90 MB) |
| Phone | Motorola Edge 50 Fusion, Android 16, arm64 — connected over Wireless debugging |
| Old app | v1.0.1 (sideloaded 29 Oct, different key) removed with the owner's approval |
| Install | **Verified** — `com.Bulkimart.user` 1.0.0 installed |
| Metro over `adb reverse` | **Verified** — bundle served (13 MB), app loads it |

### Bugs found on the device and fixed
1. **Every JSON API call failed on Android** — `boundedFetch` used `response.clone()`, which needs `ReadableStream` (absent in React Native): `ReferenceError: Property 'ReadableStream' doesn't exist`. Home showed "Wholesale/Legal availability could not be checked". Fixed in `src/api/client.js` (JSON body read once and served from memory; `portalRequest` only copies those).
2. **Metro returned 500** — watcher timed out crawling `android/app/build` (1.2 GB). Fixed in `metro.config.js` blockList.
3. **Gradle path-length failures** — fixed by long paths + CMake 3.31.6 + short CMake build root (`android/settings.gradle`).

## 16. Device test results (Motorola Edge 50 Fusion, debug build, guest — 2026-10-31)

Status: Pass · Fail · Not run. Signed-in, payment and OTP flows are **Not run**: they need a test account (no OTP was sent).

| # | Area | Expected | Actual | Status | Error / fix |
|---|---|---|---|---|---|
| 1 | App launch | Logo launch screen → Home, no crash | Launches, Home renders | Pass | — |
| 2 | Promotional splash | Studio splash (when one is live) | Not observed — confirm a splash is published in Studio | Not run | |
| 3 | Login + OTP (test account) | OTP sent, verified, signed in | Sign-in screen renders; OTP not sent | Not run | Needs test account |
| 4 | Session persistence | Signed in after relaunch | — | Not run | |
| 5 | Home | Sections, banners, sub-nav, themes from Studio | Banner, categories sub-nav, quick actions, Legal card, "Fresh finds" products load; scroll + pinned search work | Pass | Fixed bug 1 |
| 6 | Search | Text, voice, image | — | Not run | |
| 7 | Categories | Tree and product lists load | Category grid with images and subcategory counts | Pass | |
| 8 | Product details | Images, variants, offers, wishlist, add to cart | Gallery, variant picker, price/MRP, seller, stock, offers, CTA bar render | Pass (render) | Add to cart not yet tested |
| 9–12 | Cart, coupons, checkout, payments | | — | Not run | Payments need test mode |
| 13 | Orders | Guest is asked to sign in | Sign-in screen shown | Pass (guest) | |
| 14–16 | Tracking, returns, reviews | | — | Not run | Need signed-in orders |
| 17 | Wishlist | | — | Not run | |
| 18–20 | Account, addresses, wallet | | — | Not run | Need sign-in |
| 21 | E-books / PDF | | — | Not run | |
| 22 | Wholesale | | Tile now shows (availability API OK) | Partial | |
| 23 | Campaigns | | — | Not run | |
| 24–25 | Services / Legal services | | Legal card shows "Browse" (catalogue API OK) | Partial | |
| 26 | Parcel delivery | | — | Not run | |
| 27 | Maps | | No Maps key in this build → "Map unavailable" expected | Not run | Needs `GOOGLE_MAPS_ANDROID_API_KEY` + rebuild |
| 28–30 | Uploads, downloads, notifications | | — | Not run | |
| 31–32 | Logout, session expiry | | — | Not run | |
| 33 | Android back | Closes screens/panels | Product → Home; sign-in → previous tab | Pass (partial) | Exit prompt on Home not yet tested |
| 34 | Network loss / return | Offline message + Retry | — | Not run | |
