# Bulkimart Seller (Android, React Native CLI)

Native Android app for Bulkimart sellers. Bare React Native CLI with JavaScript: no Expo, no WebView, no TypeScript.
Independent of the Customer app in `../mobile-user`.

> **Status: source complete through Stage 7 (static). It has never been installed, built or run.** Current build status: `docs/FINAL_BUILD_REPORT.md`.
> The files were written on a machine with a PolinRider malware history, where running npm/node/Gradle was not allowed.
> Treat everything below as steps to perform on the rebuilt, trusted machine.

## Before anything: trusted environment

1. Fresh Windows install (or a separate clean machine). Node 20+ LTS from nodejs.org, Temurin JDK 17, Android Studio (SDK, platform-tools).
2. Clone the repository fresh from GitHub. Check that commit history after `c594599` has no `forntend/vite.config.js` payload checked out.
3. Read `package.json` here. It has no install scripts. Run `npm config get ignore-scripts` and consider `npm install --ignore-scripts` for the first install, reviewing which packages need build scripts.

## Generate the native Android project (one time)

The `android/` folder is not hand-written. It comes from the official template matching `mobile-user` versions:

```powershell
# Outside the repo, in an empty temp folder
npx @react-native-community/cli@20.2.0 init BulkimartSeller --version 0.88.1 --package-name com.Bulkimart.seller --skip-install --skip-git-init
# Copy ONLY the generated android/ folder into mobile-seller/android
```

Then in `mobile-seller/android`:
- `app/src/main/res/values/strings.xml` → `<string name="app_name">Bulkimart Seller</string>`
- `app/build.gradle` → confirm `namespace` and `applicationId` are `com.Bulkimart.seller` (this exact casing matches the Firebase registration); `versionCode 1`, `versionName "1.0.0"`.
- `AndroidManifest.xml` → only `INTERNET` for Stage 1; `android:usesCleartextTraffic="false"`; `android:windowSoftInputMode="adjustResize"`.
- App icon and splash: add the Bulkimart Seller artwork (`frontend/src/assets/seller logo.jpeg`) through Android Studio's Image Asset tool.
- Firebase (`google-services.json`) is **not** needed until Stage 3 (push). Never commit it.

## Stage 2 additions (not installed)

| Package | Purpose |
|---|---|
| `react-native-image-picker` (^8, already in `package.json`) | Camera capture and Android system photo picker for product photos |

Android configuration for Stage 2, in `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<!-- Lets the camera intent resolve on Android 11+ -->
<queries>
  <intent><action android:name="android.media.action.IMAGE_CAPTURE" /></intent>
</queries>
```

- No storage permissions are needed: gallery selection uses the system photo picker.
- The camera permission is requested at runtime only when the seller taps "Camera" (`src/utils/media.js`).
- After adding the package, rebuild the native app (`npm run android`). Metro reload alone is not enough.

## Stage 3 additions (not installed)

| Package | Purpose |
|---|---|
| `@react-native-documents/picker` (^10) | PDF/image picker for KYC documents and ticket attachments (no storage permission) |
| `@react-native-firebase/app` (^22) | Firebase core |
| `@react-native-firebase/messaging` (^22) | FCM push: token, foreground and tap handling |

Confirm each version is compatible with React Native 0.88 (`npm view <pkg> peerDependencies`) before installing.

Android configuration for Stage 3:

1. **Firebase:** copy the existing `google-services.json` (project `bulkimart-d865c`, which already contains the Android client **`com.Bulkimart.seller`**) to `android/app/google-services.json`. Do not edit the Firebase registration. The file is git-ignored; never commit it.
2. `android/build.gradle` → `buildscript.dependencies { classpath("com.google.gms:google-services:<current>") }`
3. `android/app/build.gradle` → `apply plugin: "com.google.gms.google-services"` (at the bottom).
4. `AndroidManifest.xml`:
   ```xml
   <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
   ```
   The permission is requested at runtime only when the seller turns on push in Notifications.
5. Optional: a monochrome notification icon (`@drawable/ic_notification`) and
   `<meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_notification" />`.
6. Rebuild the native app after adding these packages.

Testing rules for Stage 3:
- **Onboarding:** use a staging API (`src/config/env.js`). Register intent and the onboarding steps write a seller application.
- **Returns:** approve/reject and pickup only on test returns. A Shiprocket reverse pickup books a real courier.
- **Push:** the backend sends real notifications on real events, so use a test seller.

## Stage 6 additions (not installed)

| Package | Purpose |
|---|---|
| `@react-native-community/geolocation` (^3.4) | One-time GPS fix to pin the store |

Android: add `<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />`. It is requested only when the seller taps "Use my current location".

**Environments:** debug builds use **staging** and release builds use production (`src/config/env.js`). The staging URL is empty until the backend owner provides one; until then debug builds refuse all API calls rather than touching production.

## Install and run

```powershell
cd mobile-seller
npm install
npm start            # Metro
npm run android      # build, install and launch on the connected device
cd android; .\gradlew.bat assembleDebug   # → android\app\build\outputs\apk\debug\app-debug.apk
```

## Testing rules

- Debug builds talk to **staging** and release builds to **production** (`src/config/env.js`). Debug builds refuse all API calls until the staging URL is filled in. Use a test seller account only.
- **Do not** test "Register store" against production: OTP verification with intent `register` creates a user record.
- **Do not** submit payout requests, order status changes or cancellations on real orders without approval.
- **Do not** create Shiprocket shipments, publish products or adjust stock on production listings without approval. Products publish live immediately.
- Payment flows (Shiprocket fee, advertising, GST assistance) are not in this app yet.

**Before the first build, follow `docs/ANDROID_BUILD_READINESS.md` step by step.** Read `docs/BACKEND_CRITICAL_RISKS.md` before any production use (remediation spec: `docs/STAGE_5_BACKEND_SECURITY_PLAN.md`, `docs/BACKEND_API_CHANGES_REQUIRED.md`, `docs/SECURITY_TEST_CASES.md`), and `docs/STAGE_4_INTEGRATION_AUDIT.md` for the API compatibility table and workflow audit.

See `docs/SELLER_APP_ANALYSIS.md` for the API contract and plan, `CONVERSION_CHECKLIST.md` for status, and `MEMORY.md` for technical memory.
