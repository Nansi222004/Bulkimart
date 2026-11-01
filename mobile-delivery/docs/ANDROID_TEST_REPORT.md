# Android Test Report — Bulkimart Delivery app

Date: 2026-11-01. **No test has been executed.** The development machine failed the security gate, so Node, Jest, Metro,
Gradle, emulators and devices were not used. Nothing below is marked PASS unless it was actually checked.

## Static checks (performed with text tools, no project code executed)

| Check | Result |
|---|---|
| Every relative import resolves to a file | See FINAL_BUILD_REPORT.md §2 |
| Every named/default import is exported by its target | See FINAL_BUILD_REPORT.md §2 |
| Every package import is declared in package.json | See FINAL_BUILD_REPORT.md §2 |
| Every navigation target is a registered route | See FINAL_BUILD_REPORT.md §2 |
| No Expo packages or Expo imports | PASS |
| `gradle-wrapper.jar` SHA-256 equals Gradle 9.4.1 published checksum | PASS |
| No secrets / tokens / OTP logging in source | PASS |

## Unit tests (written, NOT RUN)

| File | Covers |
|---|---|
| `__tests__/money.test.js` | COD rounding vs backend rule (whole, .20, .49, .50, .99, ₹0.49/₹0.50, 0–₹2000 sweep), server `codAmount` handling, exact-cash validation (less, more, paise, empty, non-numeric, missing due), report limits, paise parsing, formatting |
| `__tests__/logic.test.js` | Coordinate validation incl. 0,0 and out-of-range, navigation URL fallback, phone normalisation, notification route allow-list (incl. foreign URL), rider document rules, licence expiry, pincode parsing, login session validation, status labels |

Run: `cd mobile-delivery && npm test`. Status: **NOT RUN**.

## Integration tests against staging — NOT RUN (BLOCKED: no staging URL, gate)

Login (sign in, register, wrong OTP, resend timer) · session restore · expired token → sign-out · pending/rejected/suspended routing ·
onboarding steps 1–3 with uploads + submit · duty on/off incl. refusal · offer by socket and by poll · accept / decline / expire / stale accept ·
reached store · pickup checklist + confirm · cancel before pickup · reached customer · send code · wrong code ×5 · new code · prepaid completion ·
COD exact / short / over / paise · network drop during completion · COD collect/remit reports · payout request + retry after timeout ·
earnings figures vs admin · history filters + paging · return pickup accept → code → confirm · parcel offer → codes → cash fee → complete ·
notifications inbox + push tap routing · support ticket with photos · profile service area 409 · base location · sign-out goes offline and removes push token.

## Device tests — NOT RUN

Clean install · first-launch permissions (location, notifications, camera) · denied permission paths · GPS off · slow / no network (offline banner) ·
background → resume (polling and GPS stop and restart) · app killed during a trip → restore · push in foreground / background / killed ·
small and large screens · TalkBack labels · emulator (API 24 and 36) and a physical device.

## Backend tests

No backend code was changed, so no backend test was added. Proposed changes S1–S3 (SECURITY_VALIDATION_REPORT.md) need updated tests
(`verification/financial-workflow.test.js`, `__tests__/api/delivery-otp.http.test.js`) run in staging.
