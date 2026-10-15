# Delivery login role routing — audit and fix

Implemented and verified locally on 2026-10-15. No production deployment, production database access, password changes or account migrations were performed.

## Confirmed cause

Delivery is an extension of the shared phone-based `User` identity, not a separate password account. Canonical model roles are `buyer`, `seller`, legacy `shg`, and `delivery`. `DeliveryPartner.status` controls approval; admin approval adds delivery membership. Pending applicants do not have that membership yet. Delivery and customer credentials are OTPs, so invalid-credential tests use invalid OTPs rather than passwords.

The original flow lost login context at several points:

1. `DeliveryContext.jsx::sendRiderOtp/verifyRiderOtp` used customer `/api/auth/send-otp` and `/api/auth/verify-otp`. It did not pass the Delivery form's sign-in/registration mode. Backend `auth.controller.js::verifyAndLogin` returned the correct base identity but minted `{id,type:'user'}` with no role or dashboard. The `type` identifies the User collection, not the buyer role.
2. `UserContext.jsx` initialized `currentUser` from the shared `userToken`/`userProfile` cache and treated successful shared OTP verification as buyer authentication. It did not distinguish a Delivery login. Its socket connection also selected buyer context.
3. `App.jsx` selected portals using only the current pathname; every path outside the three role prefixes rendered UserRoutes. A Delivery identity entering the shared customer login therefore stayed in the customer portal.
4. Delivery sign-in called `/delivery/start` even for login, so a shopper could unintentionally create an application. The response status was not checked before reporting login success. Logout also left some rider state in memory. Existing approval checks were present on operational APIs; this was not evidence of those APIs becoming public.

These paths were traced in source and reproduced with controlled API/component fixtures. No claim is made that the reported symptom was reproduced using a real browser or production account.

## Resulting behavior and authorization

- Shared OTP login resolves the live canonical roles. A delivery member must have a real partner record and receives `sessionRole:delivery`, a signed delivery JWT claim, and `/delivery/dashboard`. Buyer login receives `sessionRole:buyer` and the existing storefront route `/`. The customer UI preserves the requested customer tab, such as `/account` or `/orders`.
- Dedicated `/api/auth/delivery/send-otp` and `/api/auth/delivery/verify-otp` require explicit `intent:login|register`. Login requires an existing partner profile and creates nothing. Registration can create a shared buyer identity and an incomplete partner application, without granting delivery membership or approval. The existing name/document onboarding flow remains in use. A partially completed registration can be resumed by signing in.
- `/api/auth/me` restores the role using the signed context and live membership/profile. Unsupported or missing account memberships, invalid claims, expired tokens and deactivated accounts fail safely. Legacy signed user tokens without `type`/`role` retain their prior user-identity interpretation; their dashboard role is resolved from live records rather than assumed to be buyer.
- The customer session boundary verifies `/auth/me` before mounting an authenticated customer provider. Delivery sessions go to their actual dashboard. The Delivery provider separately verifies the session and partner status before restoring its dashboard. Pending/rejected/suspended applicants retain their existing application/status screens instead of being approved by a token.
- Delivery operational APIs retain `requireApprovedPartner` and now reject explicitly buyer/seller-scoped sessions. Live partner approval remains authoritative. Legacy unscoped tokens still require that live approval check. Admin exceptions are unchanged.
- A person can legitimately hold buyer and delivery membership. Existing profile, wallet and address APIs are shared identity APIs, not newly reclassified as buyer-only. An explicit **Shop as customer** action uses authenticated `POST /api/auth/customer-session`; the server verifies buyer membership and issues a buyer session. A delivery-only account is denied. A browser-supplied role cannot grant membership.
- Logout clears shared identity caches, rider approval/money caches, saved account location and checkout retry payloads. Delivery providers remount when accounts change, resetting rider state, sockets and GPS. Ring playback stops on unmount. Stale session restoration/profile responses cannot overwrite another account; pending login completions cannot restore an account after logout or a newer login.
- No password system, refresh-token service or token revocation store was added. Existing logout remains stateless: clearing the browser session does not revoke a copied JWT; server-side expiry, active-account and live approval checks continue to apply. This is an existing architecture limitation.

## Files changed

| Path | Purpose |
| --- | --- |
| `backend/controllers/auth.controller.js` | Resolve shared login roles; dedicated Delivery OTP handlers; trusted session restoration and explicit customer-session switch |
| `backend/services/loginSession.service.js` | New live membership/profile resolver and dashboard contract |
| `backend/routes/auth.routes.js` | Register dedicated Delivery endpoints using existing OTP/auth limiters; protected customer-session endpoint |
| `backend/middlewares/auth.middleware.js` | Reject unsupported signed claims while retaining legacy unscoped user compatibility |
| `backend/middlewares/vendor.middleware.js` | Require Delivery context for newly scoped operational sessions, retaining live approval |
| `backend/services/ticket.service.js` | Recognize new buyer JWT context as customer support identity; retain legacy resolution |
| `forntend/src/App.jsx` | Apply trusted session boundary to customer portal |
| `forntend/src/components/CustomerSessionGate.jsx` | New cancellable, generation-guarded role restoration; account-change handling and retry state |
| `forntend/src/utils/userSession.js` | Validated persistence, cleanup, session change notification, pending-login guards and explicit customer switch |
| `forntend/src/modules/User/context/UserContext.jsx` | Parse verified session role, route Delivery correctly, clean logout and guard stale profile/login responses |
| `forntend/src/modules/Delivery/utils/deliveryAuth.js` | New explicit Delivery API flow; check registration failures before storing session |
| `forntend/src/modules/Delivery/context/DeliveryContext.jsx` | Restore only verified Delivery sessions; dedicated login; cleanup rider state and ring |
| `forntend/src/modules/Delivery/routes/index.jsx` | Remount provider when shared account changes or logs out |
| `forntend/src/modules/Delivery/pages/DeliveryAuthPage.jsx` | Pass actual mode and default to sign-in |
| `forntend/src/modules/Delivery/pages/DeliveryProfilePage.jsx` | Explicit, server-authorized customer shopping action |
| `backend/__tests__/api/delivery-login-role.http.test.js` | 26 new API/middleware regression cases |
| `forntend/scripts/auth-role.test.mjs` | 23 new actual-provider/component/helper regression cases |
| `forntend/scripts/service-hookHarness.mjs` | Optional isolated browser-storage fixtures and restoration |
| `forntend/package.json` | Add `npm run test:auth` |
| `.gitignore`, `backend/.gitignore` | Retain new backend regression file despite existing test ignore rules |
| `DELIVERY_LOGIN.md` | Audit, implementation, validation and limitations report |

## Regression coverage and actual results

Backend fixtures mount the actual auth routes, JWT middleware and role/approval guards. User/admin/partner lookups and SMS are mocked; tokens are genuinely signed/verified. Probe endpoints test reusable guards without invoking production rider operations. Coverage includes shared buyer/Delivery login, all existing partner states, explicit registration, no implicit login registration, invalid OTP, deactivated users, malformed account roles, untrusted request roles, missing/expired/invalid tokens, legacy restoration, live approval, customer-session membership, OTP send lookup, logout and changed account identity. Dedicated OTP limiters are mocked in this new fixture; their production mounting reuses existing middleware.

Frontend tests load actual React components/providers with Vite SSR and the repository's controlled hook/effect harness. They cover customer/Delivery redirects, direct paths and refresh restoration, cached-role distrust, expired tokens, failures/retry, cross-tab changes, stale responses/unmount, both account-switch directions, failed registration, malformed API responses, actual User and Delivery providers, explicit shopping switch and late login completions. They are not DOM/browser E2E tests. SMS, sockets and push delivery are not live integrations in these fixtures.

| Command (run from indicated directory) | Actual result |
| --- | --- |
| Initial backend focused baseline: customer auth, seller auth, admin auth, delivery OTP, frontend auth static checks and onboarding regressions | 6 suites, 43 passed, 0 failed |
| Backend `npm test -- --runInBand __tests__/api/delivery-login-role.http.test.js __tests__/api/customer-auth-no-referral.http.test.js __tests__/api/seller-phone-auth.http.test.js __tests__/api/admin-auth.http.test.js __tests__/api/delivery-otp.http.test.js __tests__/services/frontend-auth.static.test.js __tests__/services/onboarding-regressions.test.js` | 7 suites, 69 passed, 0 failed; includes 26 new tests |
| Backend `npm test -- --runInBand` | 48 suites passed; 357 passed, 7 skipped, 0 failed; 364 total |
| Frontend `npm run test:auth` | 23 passed, 0 failed |
| Frontend `npm run test:services` | 16 passed, 0 failed |
| Frontend `npm run test:image-search` | 12 passed, 0 failed |
| Backend `npm run build` | Passed; existing script checks `index.js` syntax |
| Frontend `npm run build` | Passed; existing warning about chunks larger than 500 kB |
| `git diff --check` | Passed |

An intermediate full-suite run exposed 19 Service Management failures after a too-strict token-type check rejected legacy untyped signed tokens. That regression was corrected; the focused Service Management/auth rerun passed all 55 cases at that stage, and the final complete suite passed as recorded above. No unresolved failing tests remain. The seven skipped backend tests were not executed.

The final full suite includes existing seller/admin authentication, onboarding, delivery OTP/workflow, e-book storage, Service Management, image-search and unrelated marketplace tests. No existing suite was removed or disabled. No lint script is defined in either package.

## Worktree, rollout and limitations

The worktree was clean at the start. All changed files are listed above. Existing service-management/image-search work and unrelated modules were preserved; no reset, checkout, cleanup, commit or production deployment was performed. No secrets, real documents or real customer records were used. No new dependency, environment variable, database migration or infrastructure is required. Release the matching backend/frontend together because the new UI expects the session-role response and dedicated routes.

The required code-review-graph tools were not exposed in this session; tool discovery found none, so review used direct source inspection. Browser automation tools were also unavailable. Delivery and buyer flows were verified through isolated automated API/provider tests, not real-device OTP entry, a browser dashboard session, live sockets/push, staging or a deployed proxy. Production session behavior must still be checked with separate test accounts after an authorized staging rollout. Local tests do not establish production readiness. Production storage persistence, ACLs, shared-volume behavior and backup recovery remain unverified and unchanged.
