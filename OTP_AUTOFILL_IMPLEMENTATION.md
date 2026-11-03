# Mobile Number Auto-Fetch & OTP AutoFill (Android)

Customer (`mobile-user`), Seller (`mobile-seller`) and Delivery (`mobile-delivery`) apps.

## Summary

- **Phone number auto-fetch** uses Google's **Phone Number Hint API** (`Identity.getSignInClient().getPhoneNumberHintIntent`). The user taps **Select number**, or focuses an empty number field once. A system picker opens, and the chosen number is prefilled. The field stays editable. Nothing is read silently, and no phone permission is requested.
- **OTP autofill** uses the **SMS Retriever API**. The app starts a 5-minute retriever session just before it calls send-OTP. Play services delivers the one SMS that ends with the app's 11-character hash. The native side extracts only the digits and fills the OTP boxes. No SMS permission is requested.
- **No auto-verify.** An autofilled code shows the hint "Code filled from SMS. Tap Verify to continue." The server still validates every code.
- The existing endpoints, JWT sessions, seller onboarding/approval checks and delivery activation checks are unchanged. Each app keeps its own endpoints and token storage.

## Architecture

```
LoginScreen ── usePhoneNumberHint ──► BulkimartOtpAutofill.requestPhoneNumber() ─► Phone Number Hint picker
            ── useSmsOtpListener  ──► BulkimartOtpAutofill.startSmsListener()  ─► SmsRetriever + BroadcastReceiver
            ── send-otp {phone, intent, appHash} ─► backend sendOTP() ─► SMS "<#> … code is 482913 … <appHash>"
            ◄─ DeviceEvent "BulkimartOtpAutofill:code" {code} ─ (digits only; SMS text never leaves native)
            ── user taps Verify ─► existing verify-otp endpoint
```

The native module is a local Kotlin module registered manually in each app's `MainApplication.kt`. It works through the New Architecture legacy-module interop layer, and no third-party npm package was added. The same source is in all three apps; only the `package` line differs.

## Changed files

### Backend

| File | Change |
|---|---|
| `backend/services/sms.service.js` | Rewritten: `crypto.randomInt` OTP, configurable length (default **6**), SHA-256 storage, per-number resend cooldown and hourly cap, per-code attempt limit, timing-safe compare, single use, error codes, SMS Retriever message builder, pluggable SMS transport |
| `backend/controllers/auth.controller.js` | The three send-otp handlers pass `appHash` and the app (`user`/`seller`/`delivery`) and return `otpLength`, `expiresIn` and `resendAfter`. The three verify handlers return `meta.code` (`OTP_INVALID`, `OTP_EXPIRED`, `OTP_NOT_FOUND`, `OTP_ATTEMPTS_EXCEEDED`) |
| `backend/middlewares/rateLimit.middleware.js` | `otpLimiter` is now keyed on IP plus the canonical phone, so `+91 98…` and `98…` share one bucket |
| `backend/.env.example` | New OTP and SMS Retriever settings |
| `backend/__tests__/services/sms.service.test.js` | Lifecycle, expiry, attempts, cooldown, hash and SMS format tests |
| `backend/__tests__/api/{seller-phone-auth,delivery-login-role}.http.test.js`, `seller-payment.api.test.js` | Updated for the new `sendOTP` arguments and the 6-digit mock code |

### Mobile (each of the three apps)

| File | Change |
|---|---|
| `android/app/src/main/java/com/bulkimart/<app>/otp/OtpAutofillModule.kt` | **New** native module |
| `android/app/src/main/java/com/bulkimart/<app>/otp/OtpAutofillPackage.kt` | **New** package |
| `android/app/src/main/java/com/bulkimart/<app>/MainApplication.kt` | Registers `OtpAutofillPackage()` |
| `android/app/build.gradle` | Adds the two Play services dependencies |
| `android/app/proguard-rules.pro` | Keep rule (minify is currently off) |
| `src/utils/otpAutofill.js` | **New** JS bridge and hooks, identical in all apps |
| `src/components/OtpCodeInput.js` | **New** segmented OTP input, identical in all apps |

App-specific files:

- **Customer:** `src/screens/AuthPage.jsx` and `src/context/UserContext.jsx` (sends `appHash`, returns error `code`).
- **Seller:** `src/screens/auth/LoginScreen.js`, `src/components/PhoneNumberField.js` (new) and `src/services/auth.api.js`. Also new: `__tests__/otpAutofill.test.js`.
- **Delivery:** `src/screens/auth/LoginScreen.js`, `src/components/PhoneNumberField.js` (new), `src/services/delivery.api.js` and `src/context/AuthContext.js` (passes error `code` through). Also new: `__tests__/otpAutofill.test.js`.

### Web (compatibility only)

`frontend/src/modules/User/pages/AuthPage.jsx` accepted exactly 4 digits. It now accepts 4–6 digits, so it works with the new 6-digit default. The OTP labels on the web customer and seller pages no longer say "4-Digit".

## Dependencies

No npm packages were added. These Android libraries were added to each app:

```
com.google.android.gms:play-services-auth:21.3.0           # Identity Phone Number Hint
com.google.android.gms:play-services-auth-api-phone:18.0.2 # SMS Retriever
```

No Expo modules were added. The customer app stays on its current bare React Native CLI and Expo-modules setup.

## Permissions

None were added. The manifests do not contain `READ_PHONE_STATE`, `READ_PHONE_NUMBERS`, `READ_SMS` or `RECEIVE_SMS`. The SMS Retriever receiver is registered at runtime and guarded by `com.google.android.gms.auth.api.phone.permission.SEND`, so only Play services can deliver to it.

## SMS Retriever hashes

The hash is derived from the **package name and the signing certificate**, so every signing key has its own hash.

| App | Package | Debug-keystore hash |
|---|---|---|
| Customer | `com.Bulkimart.user` | `w6ytN2p371j` |
| Seller | `com.Bulkimart.seller` | `vrYW74MR6DR` |
| Delivery | `com.Bulkimart.delivery` | `C2GKYDXwVcC` |

**The release and Play Store hashes are different.** Apps installed from Google Play are signed with Google's *app signing key*, not your upload key. To avoid managing this by hand, each app **computes its own hash at runtime** (`getAppHash()`) and sends it as `appHash` with send-OTP. The server puts it in the SMS. Debug, upload-key and Play-signed builds therefore all work with no configuration.

To pin the production hashes, for example for a DLT template or `SMS_RETRIEVER_ALLOWED_HASHES`:

1. Install the Play build, sign in once, and read `appHash` from the send-OTP request in the server access log or a temporary log line. Or:
2. Download the app signing certificate from Play Console → *Test and release → App integrity → App signing*, then run:
   ```bash
   # cert.der from Play Console; prints the 11-char hash
   node -e "const c=require('crypto'),d=require('fs').readFileSync('cert.der');console.log(c.createHash('sha256').update('com.Bulkimart.user '+d.toString('hex')).digest().subarray(0,9).toString('base64').slice(0,11))"
   ```

Then optionally set `SMS_RETRIEVER_HASH_USER`, `SMS_RETRIEVER_HASH_SELLER` and `SMS_RETRIEVER_HASH_DELIVERY` (fallbacks for older app versions) and `SMS_RETRIEVER_ALLOWED_HASHES`.

## SMS template

```
<#> Your Bulkimart verification code is {#var#}.
Do not share this OTP.
{#var#}
```

The first variable is the OTP and the second is the app hash. Register this exact text as an OTP template with your DLT operator, because Indian operators drop unregistered text. The SMS Retriever needs the hash in the message. The `<#>` prefix is no longer required, but it is harmless, and keeping it keeps the template stable.

## ⚠️ No SMS gateway is integrated

Before this change, `OTP_MODE=live` generated a code and **never sent it**. No SMS provider existed in the codebase. This is still the case. `sms.service.js` now has a transport hook and logs one warning, without the code, when no transport is configured:

```js
import { setSmsTransport } from './services/sms.service.js';
setSmsTransport(async ({ phone, message, otp, appHash }) => { /* call MSG91 / Twilio / … ; never log message or otp */ });
```

Until a provider is connected, live logins cannot receive OTPs, and SMS autofill cannot be tested end to end. Mock mode (`OTP_MODE=mock`, staging only) still returns the test code `123456`; mock mode also accepts `1234`.

## Backend security

| Requirement | How |
|---|---|
| OTP generated and verified only on the server | Unchanged; the code is returned to clients only in authorised mock mode |
| Expiry | `OTP_TTL_MINUTES` (default 5), then `OTP_EXPIRED` |
| Rate-limited requests | Existing per-IP+phone limiter (5 per 15 minutes), **plus** a per-number cooldown of 30 s and a cap of 10 per hour across all IPs (HTTP 429 `OTP_COOLDOWN` or `OTP_SEND_LIMIT`) |
| Rate-limited verification | Existing per-IP limiter (10 failures per 15 minutes), **plus** each code is burned after 5 wrong tries (`OTP_ATTEMPTS_EXCEEDED`) |
| No reuse | The code is consumed on success |
| Enumeration | Existing portal-specific responses (seller and delivery "not found" messages) are unchanged. Phone hint and autofill add no new lookups |
| No bypass | The picked number is only a prefill and still needs the OTP. Autofill only fills the input; the user still taps Verify |
| No OTP in logs | Neither the server nor the apps log codes. Native code sends only the digits to JS and never sends the SMS body |

## Build and test results

- **Backend:** the OTP and auth suites (`sms.service`, `customer-auth-no-referral`, `delivery-login-role`, `seller-phone-auth` and `seller-payment`) all pass. The full suite has failures in unrelated suites that were already failing: tests that read a non-existent `../forntend/` path, a missing `rupeesToPaise` export in the Razorpay webhook test, and checkout/order-flow mocks.
- **Seller and delivery Jest:** all pass, including 15 new `otpAutofill` tests per app.
- **ESLint** on the changed mobile files: no new issues.
- **Release builds:** not run (stopped on request). The seller app's Kotlin compiled successfully with `:app:compileDebugKotlin`; the delivery and customer apps have not been compiled.

## Device test checklist (not yet run on hardware)

| Case | Expected |
|---|---|
| Phone picker, single or dual SIM | The picker lists the SIM numbers; picking one fills the 10 digits |
| No SIM, or no number known to Google | "No phone number was found on this device. Please type your number." Manual entry works |
| No Google Play services (e.g. Huawei) | The *Select number* button is hidden; manual number and OTP entry work |
| Non-Indian number picked | "Only Indian (+91) mobile numbers are supported" |
| OTP autofill | The boxes fill and the hint appears. Nothing happens until Verify is tapped |
| Manual entry, paste | Typing works. Long-press paste of `482 913` or of the whole SMS gives `482913` |
| Wrong OTP | "Incorrect OTP"; after 5 wrong tries: "Too many incorrect attempts", and the input is cleared |
| Expired OTP | "This OTP has expired. Tap Resend OTP", and the input is cleared |
| Resend | The countdown follows the server's `resendAfter`; a new retriever session starts |
| Network down | "Network error. Check your internet connection and try again." |
| App backgrounded while waiting | The receiver stays registered and the countdown resyncs on resume. The receiver is removed on destroy, on success, or on Change number |
| Release build | The hash differs from debug; it is sent automatically at runtime |

## Known limitations

1. **No SMS provider** (see above). This blocks live OTP delivery and end-to-end autofill testing.
2. **Country code:** a fixed `IN +91` prefix is shown instead of a selector, because the backend accepts only Indian 10-digit numbers (`utils/phone.js`). A real selector would need backend support first.
3. **In-memory OTP store:** state is lost on restart and is not shared between API instances. Move it to Redis before scaling horizontally.
4. **iOS:** neither API exists on iOS. The inputs set `textContentType="oneTimeCode"`, so the iOS keyboard suggestion would work.
5. **Three copies** of `otpAutofill.js`, `OtpCodeInput.js` and the Kotlin files must be kept in sync by hand. The header comments say so.
6. **Pre-existing:** `mobile-user` `npm run check:shared` reports drift in `src/shared/storefront.js`. This is unrelated to this change.
