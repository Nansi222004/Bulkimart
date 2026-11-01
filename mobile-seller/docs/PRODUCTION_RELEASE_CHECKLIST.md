# Production Release Checklist — Bulkimart Seller

Nothing below is complete. Tick an item only with evidence (date, person, build number). **Do not upload to Google Play or distribute without explicit owner approval.**

Last reviewed 2026-11-01 (Stage 7): still nothing ticked. Current status: `FINAL_BUILD_REPORT.md`.

## A. Preconditions
- [ ] Clean machine; credentials rotated; infected repos sanitised (`ANDROID_BUILD_READINESS.md` §0)
- [ ] Staging API URL set in `src/config/env.js`; production URL confirmed for release builds
- [ ] Backend R1–R7 deployed to production after staging sign-off (or written risk acceptance)
- [ ] Mobile DTO update shipped with `SELLER_DTO_V2` (`BACKEND_API_CHANGES_REQUIRED.md` §3)

## B. Build
- [ ] Dependency versions pinned and compatible with RN 0.88.1
- [ ] `android/` generated; `applicationId`/`namespace` = `com.Bulkimart.seller`
- [ ] `versionCode` / `versionName` set
- [ ] App icon (adaptive) and splash from Bulkimart Seller artwork
- [ ] Release keystore created and stored outside the repo; `keystore.properties` git-ignored
- [ ] R8/ProGuard enabled for release; keep rules verified for react-native, firebase, keychain
- [ ] Signed release APK and AAB built

## C. Configuration and privacy
- [ ] `google-services.json` (production) placed in `android/app`, not committed
- [ ] Permissions limited to INTERNET, CAMERA, POST_NOTIFICATIONS, ACCESS_FINE_LOCATION (+ IMAGE_CAPTURE query)
- [ ] Play Data safety form: phone number, store details, location (store pin), photos and documents (KYC, products), device push token; encryption in transit; deletion via support
- [ ] Privacy policy URL; permission rationale strings reviewed
- [ ] `usesCleartextTraffic=false`; no debug flags in release

## D. Quality gates
- [ ] `ANDROID_TEST_REPORT.md` all Passed on physical devices
- [ ] `SECURITY_TEST_CASES.md` 64 cases + regression Passed (or exceptions approved in writing)
- [ ] Financial figures match the web panel for test sellers
- [ ] No open critical/high defects

## E. Store listing
- [ ] Title "Bulkimart Seller", short and full description, screenshots (phone), feature graphic, category, contact
- [ ] Internal testing track first; staged rollout plan

## F. Approval
- [ ] Owner approval to publish (name, date)
