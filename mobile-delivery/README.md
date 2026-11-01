# Bulkimart Delivery — Android app (React Native CLI)

Native Android app for Bulkimart delivery partners. It is a conversion of the web portal at
`frontend/src/modules/Delivery` and talks to the existing backend (`backend/routes/delivery.routes.js`
and related routes). No Expo, no EAS: React Native CLI 0.88.1 + Gradle.

> **Status (2026-11-01): source complete, never built or run.** The development machine failed the
> security gate (see `docs/SECURITY_VALIDATION_REPORT.md`), so no Node, npm, Metro or Gradle command
> was executed. Everything below must happen on a clean machine.

## Environments

Like the Customer and Seller apps, **every build uses the live server `https://api.bulkimart.in`**
(`src/config/env.js`). There is no staging server. Test only with a test rider account: accepting orders,
completing deliveries, COD reports and payouts change live data. Setting `STAGING_API_URL` (HTTPS) later
makes debug builds use it instead.

The debug APK has the JavaScript bundled in (`debuggableVariants = []`), so it runs on a phone without Metro.
Icons and the login logo come from `frontend/src/assets/delievry logo.jpg`.

## First build (clean machine only)

```bash
cd mobile-delivery
npm ci                       # first time: npm install, then commit package-lock.json after review
npm test                     # unit tests in __tests__/
# copy google-services.json (Firebase project with client com.Bulkimart.delivery) to android/app/
cd android
gradlew.bat assembleDebug    # Windows   (./gradlew assembleDebug on Linux/macOS)
# output: android/app/build/outputs/apk/debug/app-debug.apk
```

- `android/gradle/wrapper/gradle-wrapper.jar` SHA-256 `55243ef5…1145c` matches Gradle's published 9.4.1 checksum.
- Release signing is read from `android/keystore.properties` (git-ignored). Without it the release APK is unsigned; the debug key is never used for release.
- Package ID `com.Bulkimart.delivery`, version 1.0.0 (1).

## Structure

```
App.js, index.js
src/config/env.js            environments, timings (no secrets)
src/services/                apiClient (single HTTP client), delivery.api, socket, push, geo, storage (Keychain)
src/context/AuthContext.js   session + application status (server decides)
src/context/DutyContext.js   duty, offers, active trip, returns, earnings, live location
src/screens/                 auth, onboarding, duty, active, earnings (+Cash), history, returns, parcels, profile, notifications, support
src/utils/                   money (COD rounding), location, status labels, rider document rules, session check
__tests__/                   unit tests (NOT RUN yet)
docs/                        audit, API, security, test, release and build reports
```

## Key rules

- **COD amount**: the app shows the server's `codAmount` (order total rounded to the nearest rupee, .50 up — `backend/utils/financeMoney.js`) and accepts only that exact whole-rupee amount before sending the delivery code. See `docs/FINAL_FEATURE_AUDIT.md` §COD.
- **No client-side money**: earnings, balances, payouts and COD custody are read from the server.
- **Location**: foreground only, while on duty or during an active trip. No background location permission.
- **KYC**: documents are uploaded but never displayed back; bank numbers show the last four digits.
