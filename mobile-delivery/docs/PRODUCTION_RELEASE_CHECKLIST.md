# Production Release Checklist — Bulkimart Delivery app

Every item is open. Tick only after it has actually been done.

## Before any build
- [ ] Clean build machine (see SECURITY_VALIDATION_REPORT.md §1); credentials used on the infected machine rotated
- [ ] Staging API URL confirmed by the backend owner and set in `src/config/env.js` (`staging.apiBaseUrl`)
- [ ] `npm install` on the clean machine; review and commit `package-lock.json`; `npm audit` reviewed
- [ ] `google-services.json` with Android client `com.Bulkimart.delivery` placed in `android/app/` (not committed)
- [ ] `npm test` passes; `npm run lint` clean

## Staging validation
- [ ] All integration and device tests in ANDROID_TEST_REPORT.md executed and recorded
- [ ] COD figures checked against the admin Finance Center for at least: whole, .20, .50 and .99 totals
- [ ] Payout request + admin completion verified end to end
- [ ] Push notifications verified for new offer, payout completed/rejected, COD settled

## Owner decisions
- [ ] S2: should the backend refuse COD completion when the cash amount does not match? (app already refuses)
- [ ] S1/S3/S4: approve backend OTP and stage hardening; run updated backend tests in staging
- [ ] S5: mask bank account and document URLs in `GET /api/delivery/me`
- [ ] Forward-order failure / customer-unavailable endpoint (not in backend)
- [ ] In-app map: provide an Android Maps SDK key (restricted to package + SHA-1) if a map view is wanted; navigation already works without it

## Release build
- [ ] Release keystore created and held by the owner; `android/keystore.properties` on the build machine only
- [ ] `versionCode`/`versionName` bumped
- [ ] `gradlew assembleRelease` / `bundleRelease`; install and smoke-test the signed build against production with a test rider
- [ ] Play Console: data safety form (precise location in foreground, phone number, financial info, photos), location permission declaration
