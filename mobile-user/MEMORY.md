# MEMORY — Bulkimart Customer App (React Native / Expo)

Long-term facts for anyone continuing this app. Per-screen and per-API status lives in `CONVERSION_CHECKLIST.md`.

## 1. Purpose
- Native Android app for the **Bulkimart Customer/User role** (`buyer`). A screen-by-screen conversion of the web customer app, not a redesign and not a WebView wrapper.
- Customer features only. Admin, seller, delivery-partner and desktop-only modules stay on the web.

## 2. Sources
- Web frontend `../frontend/src` (customer = `modules/User` plus shared `components/` and `utils/`). The web at 360–412 px wide is the design spec.
- Backend `../backend` (read-only for this work). Shared rules: `../backend/shared/storefront.mjs`, `celebration.mjs`, `serviceLimits.mjs`.
- No Flutter wrapper exists (intentional, confirmed by the user).

## 3. Configuration
- App name `Bulkimart`. Slug `bulkimart-user`. Scheme `bulkimart`.
- Android package `com.Bulkimart.user`, taken from `../google-services (2).json` (Firebase project `bulkimart-d865c`) and copied to `./google-services.json`. **Must be confirmed by the user before the first release build.** Never change it after a Play release.
- API base URL `https://api.bulkimart.in` (`app.json` → `expo.extra.apiBaseUrl`, read by `src/config.js`, HTTPS enforced). Socket.IO uses the same host. Website origin `https://bulkimart.in`.
- Google Maps Android key: build-time env `GOOGLE_MAPS_ANDROID_API_KEY` (`app.config.js`). Without it `extra.mapsConfigured` is false and maps show "Map unavailable".
- No secrets in `EXPO_PUBLIC_*` or in the repo. EAS manages signing.

## 4. Versions
- Expo SDK 58 (`expo ~58.0.21`), React Native 0.88.1, React 19.3, Node ≥22.13 (built on Node 24). JavaScript only.
- App version `1.0.0`, versionCode 1 (`eas.json` `appVersionSource: local`).

## 5. Folder structure and conventions
- `app/` — routes only; each file re-exports a screen. `_layout.jsx` = providers + Stack + shell overlays.
- `src/screens/` — screen bodies (ports of `modules/User/pages`). `src/components/` — shared UI (`storefront/`, `home/`, `cart/`, `services/`, `parcels/`).
- `src/context/` — `SessionContext`, `UserContext`, `StorefrontContext`. `src/hooks/` — data hooks. `src/lib/` — platform services. `src/api/client.js` — the only HTTP client. `src/theme/` — tokens.
- `src/shared/*.js` — verbatim copies of `../backend/shared/*.mjs`; `npm run check:shared` fails if they drift.
- Each file starts with a comment naming the web file it ports. Keep the web's component names.

## 6. Navigation
- One root Stack (expo-router). Routes: `index` (home), `search`, `categories`, `product?id&purchase&variant`, `cart`, `checkout`, `orders`, `order/[id]`, `review/[id]`, `account?section=wallet`, `wishlist`, `ebooks`, `wholesale`, `wholesale-cart` (redirects to the cart's Wholesale group), `campaign/[id]`, `services`, `legal-services?view=requests&id=`, `parcel-delivery?view=book|history|track&id=`.
- `useUser().setActiveNav(name)` behaves like a tab: it returns to an open copy (`dismissTo`) or pushes. `replaceNav` swaps the current screen.
- Sub-nav tabs on Home are context state with their own back history. Android back on Home steps back through tabs, then asks "Exit Bulkimart?". Full-screen panels (Account sections, modals) close on Android back first.

## 7. Auth
- Backend contract unchanged: OTP (`/api/auth/send-otp`, `/api/auth/verify-otp`) returns a JWT in the body, sent as `Authorization: Bearer`. There is no refresh endpoint.
- The token lives in SecureStore (`bulkimart_user_token`) and the profile in AsyncStorage, both mirrored in memory (`src/lib/storage.js`, hydrated before the first render).
- On launch `SessionContext` verifies the token with `GET /api/auth/me` (requires `userType:user`, `sessionRole:buyer`, roles ⊇ buyer). If offline, the app stays a guest and keeps the token.
- A 401 on a request that carried the current token clears the session. Logout deregisters the push token, clears storage and disconnects the socket.

## 8. API layer
- `request(path, {method, body, auth, headers, timeoutMs, form})` returns `{ ok, status, body }`. `boundedFetch` returns raw responses; `portalRequest` de-duplicates authenticated GETs.
- Default timeout 10 s (60 s for uploads). Network errors show an offline message. Nothing auto-retries; screens offer Retry.
- Idempotency keys exactly as the web uses them: checkout, return requests, parcel bookings and payments, legal submissions and service fees. Keys are kept in the in-memory session store until confirmed.
- Server totals, coupons, GST, eligibility and fares are always displayed as returned, never recomputed.

## 9. State
- React Context, as on the web: `UserContext` (navigation, cart, coupons, addresses, wallet, orders, wishlist, socket events, checkout) and `StorefrontContext` (Studio experience, refresh before `validUntil`). A separate `NowContext` ticks every second so only countdowns re-render.
- Web `localStorage` maps to the AsyncStorage mirror (`local`); `sessionStorage` maps to memory (`session`, per app process).

## 10. Theme
- `src/theme/index.js`: `base` (web root tokens) plus `themeFrom(tokens)`, which resolves the published Storefront Studio theme exactly like the web's `themeStyle()`. Aliases such as `primaryColor` (= action), `primaryLight` (= highlight) and `textPrimary` match the web's CSS variables.
- Fonts: Outfit and Inter embedded through the expo-font plugin.

## 11. Native integrations (web → native)
- Payments: official Razorpay SDK (`react-native-razorpay`). The result is always verified by the backend's existing verify endpoints.
- Push: expo-notifications FCM token → `POST /api/notifications/tokens` with `platform:'android'`. A foreground banner shows only for the signed-in recipient; a tap opens the mapped route.
- Maps: react-native-maps (Google). The order route uses the backend `track.route.polyline`. Parcel pins are set by tap or drag; address search uses the backend `/api/geo/forward` (the web's Places type-ahead is browser-only).
- Location: expo-location, asked only when the customer taps "Use current location".
- Files: expo-image-picker, expo-document-picker and expo-image-manipulator (review photos ≤192 KB, avatar 256 px).
  - E-books download into the cache with the session token. "View" opens the phone's PDF app (expo-intent-launcher, share sheet as fallback). "Download" uses the system folder picker.
  - Private service documents use the share sheet. Invoices use expo-print.
- Voice search: expo-speech-recognition. Celebrations: the web Canvas renderer reused through an SVG recorder (24 fps).
- Seller entry ("Become a Seller / Your Shop") opens `https://bulkimart.in/seller` in the browser.
- Profile edit and avatar are saved on the device only, the same as the web (the web does not call the profile API there).

## 12. Backend changes
- None.

## 13. Known issues
- Nothing has run on a device yet (no emulator or phone connected). Signed-in flows and payments are untested, because production OTP and payments must not be used for tests.
- Maps need `GOOGLE_MAPS_ANDROID_API_KEY` and the key's Android restrictions (package + SHA-1).
- The parcel address type-ahead is not available; "Find address" plus GPS plus a map pin replace it.
- The web OrdersPage `?payment=` redirect banner is not ported (it only serves redirect-based gateways; the app uses the native SDK).

## 14. Blocked
- Release build: needs `eas login`, confirmation of `com.Bulkimart.user`, and the user's go-ahead.
- Authenticated and payment testing: needs a test account or a non-production backend with mock OTP and Razorpay test keys.

## 15. Install and dev (React Native CLI, wireless device testing)
- Workflow: **React Native CLI** (owner's choice, 2026-10-31). No EAS, no Expo login, no Expo Go, no `expo-dev-client`. Expo packages stay as plain native libraries. `android/` is now source and tracked by git (its build output is ignored by `android/.gitignore`).
- Tooling: `@react-native-community/cli` + `cli-platform-android` 20.2.0 (the RN 0.88 template versions). JDK 17 (Temurin). Android SDK at `D:\Android\Sdk` with CMake **3.31.6**. ADB 1.0.41.
- Scripts:
  - `npm start`: Metro (`react-native start`). `npm run start:clear` resets the cache.
  - `npm run android`: build, install and launch on the connected phone.
  - `npm run android:apk`: arm64 debug APK only, written to `android/app/build/outputs/apk/debug/app-debug.apk`.
  - `npm run reverse`: `adb reverse tcp:8081 tcp:8081`.
  - `npm run logs`: RN, JS and crash log tags.
- `metro.config.js` keeps Expo's Metro defaults (expo-router needs them) and blocks `android/**/build`, `.cxx` and the project `dist/`. Without that block, the 1.2 GB build folder made Metro's watcher time out, and every bundle request returned a 500.
- **Windows build requirements.** C++ object names embed the full source path (~290 characters here):
  1. Windows long paths on: `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled=1` (admin), then reboot.
  2. CMake 3.31.6 (ninja 1.12, long-path aware). `android/settings.gradle` sets it for every native module on Windows and moves each module's CMake build folder to `C:/bmcx/<module>`. Override with `-Pbulkimart.cxxDir=...|off`.
  - Mapping a short drive with `subst` is not enough (paths stay over 260), and Expo autolinking fails at a drive root.
- Maps key: `GOOGLE_MAPS_ANDROID_API_KEY` from the environment or a Gradle property becomes a manifest placeholder (`com.google.android.geo.API_KEY`). It is never committed.
- Signing: debug builds use the standard `android/app/debug.keystore`. The release build type still uses the debug key; a real upload keystore must be configured (outside git) before any Play release.
- Phone, wireless (Android 11+): Developer options → Wireless debugging → "Pair device with pairing code", then:
  - `adb pair IP:PAIR_PORT`
  - `adb connect IP:PORT`, or rely on mDNS auto-connect
  - `adb devices`

  The port changes every time wireless debugging is re-enabled. The phone drops off when its screen locks, so keep it unlocked and charging, with "Stay awake" on, during installs.
- Install: `adb install -r app-debug.apk`. A build signed with a different key needs the old app removed first (`adb uninstall com.Bulkimart.user`, or `pm uninstall --user 0` when `adb uninstall` reports `DELETE_FAILED_INTERNAL_ERROR`). Removing it erases that app's local data on the phone.
- JS changes reload via Fast Refresh. Rebuild the APK after changing native packages, `app.json` / `AndroidManifest.xml` / Gradle files, `google-services.json` or the Maps key.
- Logs:
  - App only (PowerShell): `adb logcat --pid=(adb shell pidof -s com.Bulkimart.user)`.
  - Crashes: `adb logcat *:E AndroidRuntime:E`.
  - The app has no `console.*` calls, so tokens, OTPs and personal data never reach logcat. Keep it that way.
- Security note (2026-10-31): this laptop had npm malware. A fake npm lived in `%APPDATA%\npm\node_modules\npm` and hijacked the official `npm.cmd`, and a remote-access script sat in `%LOCALAPPDATA%`. Both are quarantined in `%USERPROFILE%\Quarantine-bulkimart-2026-10-31`. Before running npm on any machine, check that `%APPDATA%\npm\node_modules\npm` does not exist.

## 16. Checks
- `npm run lint` · `npx expo-doctor` · `npm run check:shared` · `npx expo export --platform android`

## 17. Release
- `eas login`, then set `GOOGLE_MAPS_ANDROID_API_KEY` as an EAS environment variable, then `eas build --platform android --profile production` (APK). EAS manages the keystore; never commit signing files.
