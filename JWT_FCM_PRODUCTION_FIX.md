# Production FCM authentication investigation

Status: code and local verification prepared; production login-to-FCM acceptance
has NOT been verified. No production secrets were changed and nothing was deployed.

## Evidence and remaining uncertainty

- Delivery OTP verification signs `{ id, type: 'user', role: 'delivery', iat, exp }`.
  The authenticated identity is the User ID; delivery membership comes from the
  linked DeliveryPartner record. The shared notification route intentionally
  supports customer, seller, delivery and admin credentials.
- Signing and HTTP/Socket.IO verification already imported the same `JWT_SECRET`
  module. There is no evidence of separate hardcoded signing secrets in these paths.
- The old HTTP middleware mapped all `jwt.verify` failures to `invalid token`.
  Thus the screenshot proves verification failed, but cannot distinguish expiry,
  signature mismatch, corruption or algorithm rejection. Claims/role checks run
  afterwards and were not the source of that particular message.
- Local development targets localhost:5050; production targets api.bulkimart.in.
  Using a local credential against production is a possible cause, not a proven
  explanation of the supplied screenshot. The API origin has not been changed
  by this fix.
- Startup previously used cwd-relative `dotenv/config`. Starting PM2 outside
  backend/ could select a different environment file; an inherited PM2 secret
  also takes precedence over a file. Neither condition has been verified remotely.
- The old deploy script hard-reset/cleaned the checkout and restarted the hardcoded
  legacy name `nhcone-backend`. No PM2 ecosystem definition is committed. There
  is no evidence here identifying the real production process name or replica count.
- Read-only public probes on 2026-10-19: missing Authorization and a deliberately
  invalid dummy credential both returned 401, no `meta.code`, and a stack trace.
  Request IDs: `46fbe8a4-eaec-47ad-b4e7-56a03ae9ab09` and
  `8ddadf9b-1b48-4c71-ad71-200f5063279b`. With this repository's error middleware,
  stack exposure indicates NODE_ENV=development. No real token, OTP or device
  registration was sent in these probes.

The exact production JWT rejection reason remains unconfirmed. Server access or
a fresh production login followed by its protected API response is required.

## Changes

| Files | Purpose |
| --- | --- |
| backend/config/environment.js, index.js, config/bootstrap.js | Resolve backend/.env independently of cwd before auth initialization; hosting environment retains precedence; tests never load it |
| backend/config/jwt.js, controllers/auth.controller.js, socket/socket.js | Central sign/verify helpers explicitly use existing HS256 algorithm and existing expiry; fail startup for missing/blank secret; safe startup event |
| backend/middlewares/auth.middleware.js, utils/authFailure.js | Strict single bearer extraction, safe reason codes, object-ID identity validation and distinct role/account rejection diagnostics |
| forntend/src/utils/sessionBackend.js, userSession.js, deliverySession.js, portalSession.js | Record issuing API origin on new logins; prevent portal token selection across known backend-origin changes |
| forntend/src/utils/firebaseMessaging.js | Verify the current scoped identity via /api/auth/me before sending a device token; reject stale, wrong-role or unauthorized sessions |
| backend/scripts/auditJwtDeployment.mjs, services/jwtDeploymentAudit.service.js, deploy.sh | Sanitized read-only PM2 configuration audit; require the verified process name, preserve checkout changes, restart all named workers with --update-env |
| backend/verification/, forntend/verification/, package.json files | Committed isolated auth/FCM regressions runnable with npm run test:fcm-auth |

No secret rotation, authentication bypass, new API, changed payment behavior,
FCM service change or JWT issuer/audience migration is included. Existing HS256
tokens with supported legacy claims remain compatible. Browser origin metadata
is a stale-session guard, not cryptographic authentication. Legacy unbound sessions
still require the backend preflight before FCM registration.

## Diagnostics

All authentication failures log only fixed code, status, server-generated request
ID and process ID. No header, JWT, OTP, secret, key hash or user identity is logged.
The HTTP envelope includes `meta.code` and `meta.requestId`.

| Code | HTTP |
| --- | --- |
| AUTH_HEADER_MISSING, AUTH_BEARER_MALFORMED | 401 |
| AUTH_TOKEN_EXPIRED, AUTH_TOKEN_NOT_ACTIVE | 401 |
| AUTH_SIGNATURE_INVALID, AUTH_ALGORITHM_INVALID, AUTH_TOKEN_INVALID | 401 |
| AUTH_CLAIMS_INVALID, AUTH_CLAIMS_UNSUPPORTED, AUTH_ACCOUNT_NOT_FOUND | 401 |
| AUTH_ROLE_REQUIRED, AUTH_ACCOUNT_INACTIVE | 403 |
| AUTH_CONFIGURATION_MISSING | Startup fails before listening |

An invalid-signature diagnostic proves the presented token was not verified by
that worker's key. It does not, by itself, prove which backend originally issued it.

## Deployment on the actual backend host

Run as the account that owns the production PM2 daemon, from the deployed repo.
The scripts must first be delivered through the normal Git/release process.
These commands inspect only sanitized metadata; never publish raw pm2 jlist,
pm2 env, environment dumps or credentials.

```bash
git status --short
git pull --ff-only origin main
node backend/scripts/auditJwtDeployment.mjs
read -r -p 'Verified backend PM2 name from the list: ' PM2_PROCESS_NAME
node backend/scripts/auditJwtDeployment.mjs --process="$PM2_PROCESS_NAME"
```

The listing command intentionally exits nonzero until a name is selected.
The named audit checks all matching processes against this checkout's backend/index.js,
NODE_ENV=production, expected secret and expiry, without printing secret values.
It cannot inspect the cached key inside an already running JavaScript module;
`runningKeyVerified` stays false until an actual production login test proves it.

Before restarting:

1. Preserve the intended existing production JWT_SECRET. Compare sources privately;
   do not generate a replacement to fix a mismatch. Ensure the same intended value
   reaches every worker and any additional load-balanced host.
2. Set NODE_ENV=production in the hosting/PM2 environment. Confirm all required live
   integration modes are configured; production startup deliberately rejects mocks
   and incomplete configuration. Keep the intended JWT_EXPIRES_IN (default 30d).
3. Resolve any audit mismatch before proceeding. PM2 inherits environment variables;
   editing backend/.env cannot override an explicit stale JWT_SECRET in PM2.
   Correct that launch configuration in the hosting manager or existing private
   ecosystem configuration, then repeat the audit. Do not add secrets to Git.

Deploy/restart the verified process, retaining the existing key:

```bash
bash deploy.sh "$PM2_PROCESS_NAME"
```

Or, after dependencies/builds have already been prepared on the host:

```bash
npm ci --prefix backend
npm run build --prefix backend
npm ci --prefix forntend
npm run build --prefix forntend
node backend/scripts/auditJwtDeployment.mjs --process="$PM2_PROCESS_NAME"
pm2 restart "$PM2_PROCESS_NAME" --update-env
node backend/scripts/auditJwtDeployment.mjs --process="$PM2_PROCESS_NAME"
```

Use the existing hosting deployment workflow instead when the service is not
actually managed by PM2. No server process name or deployment directory has been
invented here. For multiple hosts, repeat the private configuration check and
restart on every host behind the API hostname.

Publish the rebuilt `forntend/dist` to the separately hosted website through its
existing deployment workflow. Restarting api.bulkimart.in alone does not update
the frontend hosted at bulkimart.in.

## Production acceptance (required before declaring resolution)

In Postman, set one base URL to `https://api.bulkimart.in`. Use an approved
test delivery account and real OTP flow. Keep credentials in private variables.

1. POST `/api/auth/delivery/send-otp`: `{ "phone": "<registered phone>", "intent": "login" }`.
2. POST `/api/auth/delivery/verify-otp`: same phone/intent plus `"otp": "<received OTP>"`.
   Expect 200 and sessionRole=delivery. Store its response `token` as the login JWT.
3. GET `/api/auth/me`, Authorization: Bearer login JWT. Expect 200, delivery role,
   and the correct account identity. Use exactly one Authorization header.
4. POST `/api/notifications/tokens` with that same Authorization header and JSON
   `{ "token": "<actual Firebase device token>", "platform": "app" }`.
   Expect 200, success=true, and platform=app. The device token is not the login JWT.
5. Repeat protected checks across multiple requests/workers. For any rejection,
   correlate meta.requestId with the fixed diagnostic event and instance ID.
6. Confirm missing/invalid/expired credentials return 401 with distinct codes and
   no stack field; wrong-portal role checks return 403 where those checks apply.
7. Check real driver notification delivery and logout removal. Firebase send success
   is separate from authentication acceptance and was not live-tested locally.

Local verification commands (no production database or credentials):

```bash
npm run test:fcm-auth --prefix backend
npm run test:fcm-auth --prefix forntend
npm run build --prefix backend
npm run build --prefix forntend
git diff --check
```

Neither package defines a lint script. Changed JavaScript is syntax-checked,
and the existing relevant auth/notification/socket regression suites are run
alongside the new focused tests. Detailed run counts are reported in the task result.

Recorded local results:

| Check | Result |
| --- | --- |
| New backend JWT/FCM, startup and PM2 audit tests | 34 passed |
| Existing backend customer/seller/admin/notification/socket regressions | 47 passed |
| Frontend focused tests plus existing auth/seller notifications/startup suites | 80 passed |
| Backend build and changed JavaScript syntax checks | Passed |
| Frontend production build | Passed; existing bundle-size warning remains |
| git diff --check | Passed |
| Production accepted OTP → JWT → FCM registration | Not verified; requires server/account access |
| Bash syntax checker | Native Bash unavailable in this Windows workspace; deploy script reviewed, not executed |
