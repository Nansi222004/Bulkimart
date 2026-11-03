# Bulkimart — Remediation Plan

Audit date 2026-11-04 · commit `76e6bc8`. No fix has been applied; this is a plan. Finding IDs refer to [BULKIMART_COMPLETE_SYSTEM_AUDIT.md](BULKIMART_COMPLETE_SYSTEM_AUDIT.md).

## Stage 1 — Critical financial and security fixes (immediately)

| Finding | Change | Files | Complexity | Required tests | Validation |
|---|---|---|---|---|---|
| F-001 | Delete `POST /wallet/dev-topup` and `devQuickTopup`. If a dev helper is needed, register it only when `NODE_ENV==='test'`. | `backend/routes/wallet.routes.js:26`, `backend/controllers/wallet.controller.js:31-49` | Low | Route returns 404 in production config; wallet credit sources limited to the allowed set | Run reconciliation query R-1 on production; expect zero rows |
| F-001 incident | If R-1 returns rows: freeze those wallets, list orders paid with wallet by those users, hold related seller ledger lines before the next weekly payout, and decide recovery | Ops / data | Medium | — | Every flagged order is accounted for before payout day |
| F-002 | Make the admin router case-sensitive (`express.Router({ caseSensitive: true, strict: true })`), **and** mount finance routes on a sub-router behind `requireFinancePermission` instead of a regex on `req.path`. Add a permission re-check inside payout settle and reject. Put `/wallet/admin/*` credit and debit behind `manage_finance`. | `backend/routes/admin.routes.js:88-94`, `routes/wallet.routes.js:36-37` | Low–Medium | Non-finance admin gets 403 on every finance route in lower, mixed and upper case and with encoded segments | Automated route-table test enumerating all finance paths |

## Stage 2 — High-risk business logic

| Finding | Change | Files | Complexity | Tests |
|---|---|---|---|---|
| F-003 | Per delivery: max issued codes (e.g. 3), cumulative attempt cap (e.g. 10), 60 s issue cooldown. Use `crypto.randomInt`. Add a per-rider rate limiter on generate and verify. Notify admin when the cap is hit. Apply the same cumulative cap to the return-pickup OTP (F-011). | `backend/controllers/deliveryPartner.controller.js:1500-1600`, `backend/routes/delivery.routes.js:83-84`, `backend/services/returnPickup.service.js:432-470` | Medium | Regeneration does not reset the cumulative counter; cap enforced; concurrent verify still credits once |
| F-004 | New sweeper step: online orders `placed` with Payment `pending/failed` older than a TTL. First reconcile with Razorpay (`getRazorpayPaymentStatus`); settle if captured, otherwise `cancelOrderAndRestore` (restores stock and coupon). Consider capping concurrent unpaid orders per user. | `backend/services/orderSweeper.service.js`, `backend/controllers/order.controller.js` | Medium | Captured-late payment is never cancelled; unpaid order is released exactly once; coupon `usedCount` restored |

## Stage 3 — Payment and settlement reconciliation

| Finding | Change | Files | Complexity | Tests |
|---|---|---|---|---|
| F-006 | Automate refund obligations of kind `CANCEL:*`: a sweeper calls `processRefundObligation`, or an admin queue with an ageing alert and SLA. | `backend/services/paymentRecovery.service.js`, `orderSweeper.service.js` | Medium | Obligation processed once; provider failure retried; webhook reconciles |
| F-020 | Add a "payout returned by bank" action: compensating `settled → eligible` (or `held`) entries plus a status `RETURNED`. | `backend/controllers/adminSellerFinance.controller.js` | Medium | Balance restored once; UTR receipt kept |
| F-012 | Book the COD rounding difference to a `cod_rounding` account at verification. | `backend/services/orderFinance.service.js` | Low | Trial balance nets to zero for rounded orders |
| Ops | Schedule reconciliation queries R-1…R-15 weekly, or expose them in the Finance Center. | scripts | Low | — |

## Stage 4 — Application workflow and deployment

| Finding | Change | Files | Complexity |
|---|---|---|---|
| F-005 | Fix the path to `frontend` in `deploy.sh` and `backend/index.js` (or confirm the server layout and document it). Make the script restart PM2 even if the frontend build fails, or fail before pulling. | `deploy.sh:39`, `backend/index.js:120` | Low |
| F-008 | Move OTP state to MongoDB (TTL index) or Redis so it survives restarts and works across instances. | `backend/services/sms.service.js` | Medium |
| F-009 | Run sweepers in a single designated process (env flag or PM2 `instance_var`), or take a DB lease per tick. | `backend/index.js`, `orderSweeper.service.js` | Low–Medium |
| F-016 | Decide whether exchanges are in scope; if so, design them on top of Return plus a new order. | — | High |
| Bank offers | Not implemented; confirm scope. | — | — |

## Stage 5 — Data integrity

- Run R-2…R-11 and R-13. Resolve each mismatch through the existing historical-batch or reversal workflows, never by editing snapshots.
- R-6: list `held_missing_rule` orders and route them through historical batches.
- Pin backend dependency versions (F-015). Run `npm audit` on a trusted machine.

## Stage 6 — UI, privacy and performance

| Finding | Change |
|---|---|
| F-010 | Remove the OTP from the push `message`; keep it in-app only, as the code comment intends |
| F-013 | Strip `financialSnapshot`, `financialOperationLog` and `codFinance` internals from buyer responses (`order.controller.js:1029`) |
| F-014 | Show the rider a breakdown that sums to the rounded collect amount |
| F-007 | Shorter access tokens plus refresh, or a server-side `tokenVersion` checked in `protect`; consider httpOnly cookies and enable CSP |
| F-017 | Remove the `/api/analytics` placeholder |

## Stage 7 — Regression testing

- Fix the currently failing backend suites first (see application report §6), so regressions are visible.
- Add tests for every finding above. Priority: F-001 route absence, F-002 case and encoding matrix, F-003 cumulative OTP cap, F-004 sweeper.
- Add DB-backed (mongodb-memory-server replica set) end-to-end tests for: wallet checkout funding source, cancellation → refund obligation → processed, and COD collect → verify → post → release → payout → settle.

## Stage 8 — Production readiness verification

1. R-1 is clean, or the incident is closed.
2. All Stage 1–2 fixes are deployed, and their tests pass in CI.
3. Server checks: directory layout, PM2 mode and instance count, Nginx/proxy hop count, Razorpay auto-capture setting, webhook URL and secret.
4. Reconciliation R-2…R-15 shows no unexplained difference.
5. A chartered accountant signs off on F-018/F-019 (GST treatment, place of supply, TCS/TDS rates).
6. Audit the modules not covered here: parcel, legal, GST assistance, advertising billing, packaging, wholesale, e-books, and the full admin controller.

| Stage | Risk if skipped | Est. effort |
|---|---|---|
| 1 | Direct, unlimited monetary loss | < 1 day plus incident review |
| 2 | Fraudulent deliveries, inventory DoS | 2–3 days |
| 3 | Delayed customer refunds, unbooked differences | 3–5 days |
| 4 | Failed or partial deployments, login failures | 1–3 days |
| 5–6 | Silent data drift, minor leaks | 3–5 days |
| 7–8 | Regressions reach production | ongoing |
