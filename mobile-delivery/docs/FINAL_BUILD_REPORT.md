# Final Build Report — Bulkimart Delivery (Android, React Native CLI)

Date: 2026-11-01. **No APK exists.** The security gate failed, so no Node, npm, npx, Metro or Gradle command was run,
nothing was installed, built, installed on a device or tested at runtime.

Status words: **PASS**, **FAIL**, **BLOCKED**, **NOT IMPLEMENTED**, **NOT RUN**.

## 1. Security gate — FAIL
Persistence files of a Node-based remote agent remain on the machine (`~/.local/share/runtimedev-link`, `~/.config/runtimedev-link`,
C2 `194.11.226.41:4000`), plus a payload in `D:\Appzeto_Projects\safe-fire`. Earlier Defender detections of a `node -e` loader
beaconing to `95.135.181.151`. Details: SECURITY_VALIDATION_REPORT.md.

## 2. Work completed (static, not run)

| Item | Status |
|---|---|
| `mobile-delivery/` React Native CLI 0.88.1 project (same versions as `mobile-seller`), no Expo | Done |
| Android native project: package `com.Bulkimart.delivery`, namespace `com.bulkimart.delivery`, Kotlin MainActivity/MainApplication, manifest (foreground location, notifications, camera), release signing via owner keystore only | Done — NOT RUN |
| 16 screens + 2 offer modals, 2 contexts, 7 services, 8 util modules | Done — NOT RUN |
| 44 API entries + socket, all MATCH backend source (API_INTEGRATION_REPORT.md) | Done — NOT RUN |
| Unit tests: 2 files covering COD rounding, validation, routing, documents, session | Written — NOT RUN |
| Web portal fixes W1 (crash: missing `useMemo` import), W2 (false "Online" toast), W7 (suspended rider kept dashboard) | Done — NOT RUN |
| Backend | Not changed. Findings S1–S7 with proposed fixes (SECURITY_VALIDATION_REPORT.md §3) |

Static checks (PowerShell text scan, no project code executed), 52 source files:
- Relative imports resolve: **PASS**
- Named and default imports exported by their targets: **PASS**
- Every package import declared in `package.json`: **PASS**
- Every navigation target registered (16 routes): **PASS**
- Expo references in app source, config and android/: **PASS** (0)
- `gradle-wrapper.jar` SHA-256 `55243ef57851f12b070ad14f7f5bb8302daceeebc5bce5ece5fa6edb23e1145c` = Gradle 9.4.1 published checksum: **PASS**

## 3. Requested items and their status

| Area | Status | Reason |
|---|---|---|
| Staging API URL | BLOCKED | Not provided; debug builds fail closed |
| Dependency install / lockfile | BLOCKED | Security gate |
| Unit, integration, device tests | NOT RUN | Security gate + staging |
| `gradlew assembleDebug` | NOT RUN | Security gate |
| APK path / package / version / size / install / launch / workflows | NOT RUN | No APK |
| Backend hardening S1–S3 and COD completion rule | BLOCKED | Owner decision + staging tests |
| Forward-order failure, pickup OTP, dashboard counters, exchanges, proof photos | NOT IMPLEMENTED | No backend support |
| In-app map view | NOT IMPLEMENTED | Needs Android Maps SDK key; external navigation implemented |
| Git branch `mobile/delivery-app-conversion` + commit | NOT RUN | Working tree holds unrelated uncommitted `mobile-user/` work on `storage/server-media`; owner must choose the base branch |

## 4. Expected output once unblocked

- `cd mobile-delivery\android && gradlew.bat assembleDebug`
- APK: `mobile-delivery/android/app/build/outputs/apk/debug/app-debug.apk`
- Verify: `applicationId com.Bulkimart.delivery`, `versionName 1.0.0`, `versionCode 1`, debuggable, API = staging URL, size, install, launch, then the workflow list in ANDROID_TEST_REPORT.md.

## 5. Update 2026-11-01 11:16 — APK built and launched

The owner accepted the machine risk (malware folders since removed) and asked for the same setup as the seller and user apps.

| Check | Result |
|---|---|
| Server | Live `https://api.bulkimart.in` in all builds (no staging exists) — confirmed inside the APK's JS bundle |
| `npm install --ignore-scripts` (918 packages) + scan for known malware markers | PASS |
| `npm test` (2 suites, 69 tests) | PASS |
| `gradlew assembleDebug` (GRADLE_USER_HOME on D:) | PASS (17 min) |
| APK | `android/app/build/outputs/apk/debug/app-debug.apk`, 88.4 MB, `com.Bulkimart.delivery` 1.0.0 (1), label "Bulkimart Delivery", JS bundled (runs without Metro) |
| Icon / logo | From `frontend/src/assets/delievry logo.jpg` |
| Install + launch on the owner's phone (wireless adb) | PASS — sign-in screen shown, no crash |
| Sign-in and delivery workflows on the live server | NOT RUN (needs a test rider number and OTP) |
