# Android Build Readiness — Bulkimart Seller

Static review only. The `android/` folder does not exist yet, and nothing has been installed or built.
Every step below runs on the **rebuilt, trusted machine**, in order.

## 0. Machine and repository

1. Clean Windows install (or a separate clean machine). Don't restore old user profiles, VS Code extensions or global npm folders.
2. Install from official sources only: Node 20+ LTS (nodejs.org), Temurin JDK 17, Android Studio (SDK Platform for the RN 0.88 template's compileSdk, Build-Tools, Platform-Tools).
3. Set `JAVA_HOME` and `ANDROID_HOME`. `where.exe node` / `npm` / `java` / `adb` must point to the official install paths.
4. Clone the repository fresh. Before running anything, scan the config files for the PolinRider pattern: long lines or tab-padding after `});` in `*.config.js`. Check that `mobile-seller/` has no install scripts (`package.json` has none).
5. Rotate every secret that lived on the old machine (see the security notes from Stage 0).

## 1. Dependencies (declared in `package.json`, none installed)

| Package | Version | Native? | Notes |
|---|---|---|---|
| react / react-native | 19.3.0 / 0.88.1 | yes | same as `mobile-user` |
| @react-native-community/cli (+ platform-android) | 20.2.0 | — | bare CLI |
| @react-navigation/native, native-stack, bottom-tabs | ^7 | — | |
| react-native-screens | ~4.30.0 | yes | MainActivity tweak (step 3) |
| react-native-safe-area-context | ~5.10.1 | yes | |
| react-native-svg | 15.16.0 | yes | sales chart |
| @react-native-async-storage/async-storage | 2.2.0 | yes | |
| @react-native-community/netinfo | 12.0.1 | yes | |
| react-native-keychain | ^10 | yes | token storage |
| react-native-get-random-values + uuid | ^1.11 / ^11 | yes / — | imported first in `index.js` |
| axios | ^1.7 | — | |
| react-native-image-picker | ^8 | yes | camera, photo picker |
| @react-native-documents/picker | ^10 | yes | PDF/images |
| @react-native-firebase/app, messaging | ^22 | yes | FCM |

Before installing, check each package's peer range against RN 0.88 (`npm view <pkg> peerDependencies`) and pin exact versions in `package.json`. First install: `npm install --ignore-scripts`, review which packages need build scripts, then rebuild.

## 2. Generate the native project

```powershell
# Outside the repository, in an empty folder
npx @react-native-community/cli@20.2.0 init BulkimartSeller --version 0.88.1 --package-name com.Bulkimart.seller --skip-install --skip-git-init
# Copy only the generated android/ folder into mobile-seller/android
```

Check: `android/app/build.gradle` has `namespace` and `applicationId` = **`com.Bulkimart.seller`** (exact casing; it matches the Firebase registration). `app.json` `name` = `BulkimartSeller` must equal the component name in `MainActivity` (`getMainComponentName`).

## 3. Native configuration

| File | Change |
|---|---|
| `res/values/strings.xml` | `<string name="app_name">Bulkimart Seller</string>` |
| `app/build.gradle` | `versionCode 1`, `versionName "1.0.0"`; Hermes on (template default) |
| `MainActivity.kt` | react-native-screens: `override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(null) }` |
| `AndroidManifest.xml` | `INTERNET` (template); `CAMERA`; `POST_NOTIFICATIONS`; `<queries><intent><action android:name="android.media.action.IMAGE_CAPTURE"/></intent></queries>`; `android:usesCleartextTraffic="false"`; `android:windowSoftInputMode="adjustResize"` on the activity |
| Firebase | Copy the existing `google-services.json` (project `bulkimart-d865c`, client `com.Bulkimart.seller`) to `android/app/`. **Don't edit the Firebase registration. Never commit the file** (git-ignored at the root and in `mobile-seller/.gitignore`) |
| `android/build.gradle` | `classpath("com.google.gms:google-services:<current>")` |
| `android/app/build.gradle` | `apply plugin: "com.google.gms.google-services"` |
| Notification icon (optional) | `@drawable/ic_notification` + `default_notification_icon` meta-data |
| App icon / splash | Android Studio Image Asset from `frontend/src/assets/seller logo.jpeg`; splash = template background in brand aqua `#eaf9fe` |
| Release signing | New upload keystore stored outside the repo; `keystore.properties` git-ignored; never reuse the Customer app's key |

No storage permissions are needed: the gallery and document pickers use system pickers. No location permission is needed: the GPS pin isn't built.

## 4. Configuration choice before the first run

`src/config/env.js` points at **production** (`https://api.bulkimart.in`). For integration testing, point it at a **staging** API. Several flows write data: registration, onboarding, products, stock, order status, returns, tickets and push tokens.

## 5. Build and run

```powershell
cd mobile-seller
npm start
npm run android
cd android; .\gradlew.bat assembleDebug   # app\build\outputs\apk\debug\app-debug.apk
npm run lint
```

## 6. Known build-time risks

- **Version drift:** library majors above were chosen for RN ~0.8x. Confirm them; RN 0.88 may need newer minors.
- **Firebase on the New Architecture:** confirm that the @react-native-firebase major supports RN 0.88.
- `uuid` v11 is ESM-only; Metro in RN 0.88 resolves package `exports`. If not, pin `uuid@9`.
- `react-native-keychain` `ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY` is iOS-oriented; Android ignores it safely.
- `ToastAndroid` and `PermissionsAndroid` are Android-only (this is an Android-only app).
