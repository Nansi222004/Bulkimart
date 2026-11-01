# Final Build Report — Bulkimart Seller (Android, React Native CLI)

## Update 2026-11-01: first build and device run

The owner explicitly accepted the risk of building on this machine; the malware findings in §1 are **still unresolved**. Precautions: packages were installed with `--ignore-scripts`, and config files were scanned for injected code before and after install.

| Step | Result |
|---|---|
| `android/` generated (RN CLI 20.2.0, RN 0.88.1, no Expo); app ID `com.Bulkimart.seller`, namespace `com.bulkimart.seller`, name "Bulkimart Seller", 1.0.0 / 1, permissions INTERNET, CAMERA, POST_NOTIFICATIONS, COARSE + FINE location, camera `<queries>`, Firebase plugin | PASS |
| `npm install --ignore-scripts` (skipped scripts: `@firebase/util`, `protobufjs`; neither is needed on Android) | PASS |
| Unit tests (Jest): 38 tests, 2 suites (formatting, phone, advertising, notification routing, finance validators, orders, wholesale, API client fail-closed / 401 / errors / network) | PASS |
| ESLint | PASS (0 errors, 4 inline-style warnings) |
| `assembleDebug` attempts 1–4 | FAIL (C: drive full; Gradle download timeout; `@react-native-documents/picker` 10.1.7 incompatible with RN 0.88) |
| `assembleDebug` attempt 5 (picker 12.0.3) | **PASS** |
| APK `android/app/build/outputs/apk/debug/app-debug.apk`, 94.7 MB, debuggable, arm64-v8a + x86_64, min SDK 24, target 36 | PASS |
| Install on Motorola Edge 50 Fusion (Android 16, wireless adb) | PASS |
| Launch, sign-in screen renders | PASS |
| Send OTP with dummy number → "staging API address is not configured", no request sent (fail-closed) | PASS |
| Sign in / Register tab switch | PASS |
| Back button exits cleanly, no crash | PASS |
| Login, all screens behind login, uploads, GPS, push, orders, advertising, 64 security cases | NOT RUN (no staging API) |
| Backend features on staging | BLOCKED (no staging server) |

Bugs found and fixed during the run:
1. The document picker failed to compile with RN 0.88 → upgraded to 12.0.3 (same API).
2. Android 12+ ignores a request for FINE location alone → now requests FINE + COARSE and explains when only "approximate" is granted.
3. Firebase namespaced API deprecation warnings → switched to the modular API (`index.js`, `services/push.js`).
4. Lint: 3 hook-dependency errors (misplaced disable comments) and 1 shadowed variable fixed.

Notes:
- A debug APK loads JavaScript from Metro on the PC (`adb reverse tcp:8081 tcp:<metro port>`). Port 8081 refused to bind on this PC, so Metro ran on 8082. A standalone test APK needs a staging bundle once staging exists.
- Gradle cache/temp live on `D:\build-cache` (C: was full). Build command: `GRADLE_USER_HOME=D:\build-cache\gradle-home`, then `gradle assembleDebug`.

Date: 2026-11-01 (Stage 7). **No APK exists.** The security gate failed, so no Node, npm, npx, Metro or Gradle command was run, and nothing was installed, built or tested.

Status words: **PASS**, **FAIL**, **BLOCKED**, **NOT IMPLEMENTED**, **NOT RUN**.

## 1. Security gate (read-only checks, 2026-11-01)

| Check | Finding | Result |
|---|---|---|
| Malware persistence | `~/.local/share/runtimedev-link/{start.vbs, runtimedev-link.task.xml}` and `~/.config/runtimedev-link/{agent.env, agent.env.bat}` still present (dated 2026-10-31 10:04) | FAIL |
| Repository payload | `D:\Appzeto_Projects\safe-fire\frontend\postcss.config.js` still present (13,099 bytes) | FAIL |
| Defender | Trojan detections 2026-10-31 11:08 and 12:55 (`WedmeGood1\Frontend\vite.config.js`); earlier `node.exe -e` beacon to `95.135.181.151` (2026-10-26) | FAIL |
| Windows reinstall | OS installed 2026-02-17, not reinstalled | FAIL |
| Scheduled tasks | Only `\Microsoft\Windows\DirectX\DirectXDatabaseUpdater` matched the search; Microsoft-signed, legitimate | PASS |
| `.git/hooks` in Bulkimart1 | Only sample hooks; no `core.hooksPath` | PASS |

Gate result: **FAIL**. Only static source work was done.

## 2. Work completed in Stage 7 (static, not run)

| Item | Files | Status |
|---|---|---|
| Wholesale prices per saved variant: MOQ, increment, quantity tiers; web validators ported; product `version` sent; 409 handled; shown only with an approved Wholesale channel | `src/utils/wholesale.js`, `src/screens/products/WholesalePricingScreen.js`, `src/services/product.api.js`, `ProductDetailScreen.js`, `RootNavigator.js` | Implemented — NOT RUN |
| Wholesale terms shown per variant on product detail | `ProductDetailScreen.js` | Implemented — NOT RUN |
| Advertising views, clicks and click rate (free-trial split when used) | `src/components/CampaignMetrics.js`, `advertising.api.js`, `CampaignDetailScreen.js` | Implemented — NOT RUN |
| Screen count corrected: 39 routed screens (34 stack + 5 tabs), not 40 | docs | Done |
| README test rule corrected (debug = staging, not production) | `README.md` | Done |

Static checks run (PowerShell text scan, no project code executed):
- Relative imports resolve: **PASS**.
- Named and default exports exist: **PASS**.
- Every package import is declared in `package.json`: **PASS**.
- Every `navigate`/`replace` target is a registered route: **PASS**.

Totals: 122 files; 78 API calls (70 MATCH, 8 UNKNOWN, 0 MISMATCH).

## 3. Requested items and their status

| Area | Status | Reason |
|---|---|---|
| E-books (digital listings + PDF upload) | NOT IMPLEMENTED | Backend supports it; deferred. Note: `POST /products/:id/digital-file` lacks `requireSellerSession` (same class as R7) |
| Bulk upload (XLSX + image ZIP) | NOT IMPLEMENTED | Backend supports it; desktop-oriented file workflow |
| Payments (ads, Shiprocket fee, GST fee, Services) | BLOCKED | Needs Razorpay test keys, staging and owner approval |
| Backend: commission-rates endpoint, invoice PDF, stock history, exchanges, notification preferences, rejected-seller resubmission, bank-change workflow | BLOCKED | The task requires staging validation, and none exists. Untested backend changes to bank, KYC and finance flows on a compromised machine are unsafe. Specs: `STAGE_5_BACKEND_SECURITY_PLAN.md`, `BACKEND_API_CHANGES_REQUIRED.md` |
| Staging API URL | BLOCKED | Not provided; debug builds fail closed |
| `android/` generation | BLOCKED | Requires running the React Native CLI |
| Dependency install | BLOCKED | Security gate |
| Unit, integration and Android tests | NOT RUN | Security gate |
| 64 security cases | NOT RUN | Gate + staging + backend changes |
| `gradlew assembleDebug` | NOT RUN | Security gate |
| APK path / package / version / size / install / launch | NOT RUN | No APK |
| Git branch `mobile/user-seller-updates` + commit | NOT RUN | Branch does not exist. The working tree holds 69 uncommitted changes from other work (mostly `mobile-user/`, on branch `storage/server-media`). The owner must choose the base branch. |

## 4. Expected build output (once unblocked)

- Debug APK: `mobile-seller/android/app/build/outputs/apk/debug/app-debug.apk` via `cd android; .\gradlew.bat assembleDebug`.
- Expected values to verify:
  - `applicationId com.Bulkimart.seller`
  - `versionName 1.0.0`, `versionCode 1`
  - debug build type → staging API
- No release keystore will be created without owner authorisation.

## 5. Steps to finish, in order

1. Rebuild Windows (or use a separate clean machine). Rotate all credentials from a clean device. Remove infected commits and files from `safe-fire`, `WedmeGood1` and other affected repos.
2. Create the branch: from `main`, run `git switch -c mobile/user-seller-updates`, then commit only `mobile-seller/`.
3. Provide the staging API URL in `src/config/env.js`.
4. Generate `android/` (README "Generate the native Android project"). Install with the lockfile (`npm ci --ignore-scripts` first, then review). Build `assembleDebug`.
5. Run `ANDROID_TEST_REPORT.md` and `SECURITY_TEST_CASES.md` on staging with a test seller, and record actual results.
6. Implement the backend items on staging behind flags. Then complete e-books, bulk upload and payments.
7. Work through `PRODUCTION_RELEASE_CHECKLIST.md`.
