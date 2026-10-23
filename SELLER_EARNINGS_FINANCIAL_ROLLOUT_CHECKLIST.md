# Seller Earnings financial rollout checklist

Prepared 2026-10-23. **Not an activation authorization.** Complete the implementation report's verification and resolve the gates below before an operator changes any production configuration. No production steps in this file were executed.

## Approval and policy gates

- [ ] Resolve/triage the wholesale catalogue authentication regression without weakening authorization assertions.
- [ ] Approve exact v2 commission versions, channel/vendor/scope, effective dates, enabled/disabled precedence and tax treatment. Do not convert legacy rates or use today's rule for historical orders.
- [ ] Approve discount funding ownership and reimbursement allocation. Until implemented and verified, `held_discount_policy` snapshots cannot post; never manually change their state to configured.
- [ ] Define any missing merchandise GST, provider fee, reverse-logistics, payout minimum/fee and exchange policy. Absence is not permission to choose a value.
- [ ] Decide the operational treatment of refunds before initial financial allocation and unsupported/shared cancellation-refund exceptions. Keep them blocked until covered by reviewed tests.
- [ ] Record `FINANCE_POLICY_APPROVAL_REFERENCE` and `FINANCE_E2E_APPROVAL_REFERENCE` only after accountable review; test fixture references are never valid approvals.

## Infrastructure and access

- [ ] Verify transaction-capable MongoDB replica set/sharded topology; financial mutation must fail closed on unsupported standalone deployments.
- [ ] Inspect existing seller ledger unique event/entry indexes, seller payout idempotency uniqueness, required monitoring indexes and existing finance index preparation dry run. Apply indexes only through a separately authorized operation and duplicate preflight.
- [ ] Pre-provision `seller_payout_receipts` if deployment policy disallows first-use collection creation in transactions; preserve its built-in unique `_id` index. It is the global normalized transfer-reference claim.
- [ ] Restrict write access to `finance_approved_processes`, `finance_historical_reviewed_batches`, immutable ledger and receipt collections. Normal application finance routes cannot provision approval records. Separate DB approval/migration credentials from application credentials; retain change audit.
- [ ] Explicitly assign `manage_finance` to authorized active Admins, including superAdmins if intended. No implicit role bypass remains for the protected finance routes. Validate unauthorized Admins receive403.
- [ ] Separate the beneficiary ownership reviewer and bank transfer reconciler; require two active finance identities and retained external evidence. Do not share an operator login.
- [ ] Verify protected full destination snapshots, backups, access and evidence retention. Ordinary finance responses should expose only bank name/last4/UPI-presence; never paste full account data into a reason or reference.

## Approved manual beneficiary process

- [ ] Establish a genuine external ownership-verification process. A populated account number/UPI ID is not verification.
- [ ] Separately provision its reviewed record: `_id` exact process approval reference; `kind: bank_beneficiary_verification`; `status: approved`; immutable policy `version`; valid `effectiveAt`; optional `expiresAt`; `approvedBy` an active finance Admin ObjectId; `approvalEvidenceReference` to retained evidence. No deployment seed creates this automatically.
- [ ] Test missing, expired, revised and revoked processes fail closed. Revised processes need new destination evidence; prior review history must be retained.
- [ ] Review the destination frozen on each request, not a later edited seller account. Compare the fingerprint, amount, currency and seller before external transfer. A mismatching preview must be refreshed.

## Isolated acceptance before activation

- [ ] Run the exact frontend/backend commands in the implementation report using the sanitized runner and isolated replica sets.
- [ ] Exercise real provider sandbox capture→partial/full refund→compensation→release with test credentials and independently verify provider records. Mock tests alone are insufficient for banking readiness.
- [ ] Prove duplicate/late events, pending/unverified refunds, full refunds and return-window holds never release residual money incorrectly.
- [ ] Prove COD assigned-rider collection, remittance report, independent receipt, discrepancy/dispute and manual refund evidence remain distinct. Delivery OTP must not mark cash received.
- [ ] Prove concurrent seller requests, Return compensation and settlement cannot overspend. Verify one case-normalized bank reference cannot reconcile two payouts across sellers.
- [ ] Review invalid currency/precision and raw historical inconsistencies: APIs must report an error, not a fabricated zero.
- [ ] Check Customer discount display/Coins compatibility and Seller/Admin finance on narrow mobile and desktop. Check unavailable APIs and zero balances separately.
- [ ] Re-run production builds and review chunk-size/performance warnings. Confirm no schema/index boot process performs an unapproved migration.

## Historical exceptions and separately reviewed recovery

- [ ] Regenerate a fresh read-only sanitized report for the explicitly authorized orders. Offline sample evidence is dated2026-10-23 and is not current bank evidence.
- [ ] Keep `ORD-20261015-K2OCHK` blocked pending original agreement, legacy capture verification and delivery evidence; keep `ORD-20261019-CIRFK5` blocked pending original agreement and verified COD custody/platform receipt. Their proposed payable is null.
- [ ] Preserve one row per seller/order/item, manifestVersion1, exact evidence/hash, deterministic `HISTORICAL:<order>:<item>:v1` key, batch ID, operator/reviewer, contract/policy/evidence and explicit entitlement approval. Reconcile prior refunds, payouts and unattributed ledger before any proposal.
- [ ] Do not add `--apply` to the read-only command or attach apply to an audit route. Review exact per-row amounts separately. An uploaded JSON amount is not an approved batch.
- [ ] If explicitly authorized later, provision a versioned reviewed batch in the protected approval collection. It must contain independent active finance `operatorId`/`reviewerId`, approved status, exact `approvalReference`, SHA256 of serialized reviewed rows, original contract/funding references and exact paise amounts. Keep approvals immutable under operational access control.
- [ ] Every approved row requires valid order/item/seller IDs, evidenceHash, originalAgreementReference, policyVersion, fundingEvidenceReference, entitlementApprovalReference, currencyINR, integer gross/eligible/commission/tax/proposedPayablePaise and `net+commission+tax=eligible`. COD requires codCustodyApprovalReference; prior refunds/payouts require their explicit reconciliation references. Reject unknown/null entitlement.
- [ ] Rehearse stale evidence, duplicate batch/event, process crash, concurrent Return and multi-row transaction rollback in an isolated DB. Apply only the specifically approved batch through the separate service under authorized release gates.
- [ ] Applied historical adjustments are held only. They do not create a fake v2 snapshot or authorize historical release. Design and approve any historical release separately with original funding and return evidence.

## Controlled activation and operations

- [ ] Take audited backups and record code revision, policy/process versions, test results, operator identities and activation ticket.
- [ ] Enable snapshots/operations/payouts separately, only under explicit production authorization. Leave later stages disabled until each acceptance gate passes. This implementation did not enable any flag.
- [ ] Inspect new snapshot components against Payment amounts and rule inputs; verify discount-policy/missing-rule holds are visible.
- [ ] Operators preview, supply evidence/reason and submit the current financial revision. Stale versions require a new preview; success requires a confirmed server response.
- [ ] Allocate verified delivered orders into held, compensate completed Returns, then release only cleared entitlement. No sweeper automatically credits historical orders.
- [ ] Manually perform an external bank transfer only after destination/amount and current reservation checks. A successful request/review is not a transfer.
- [ ] Independent operator compares the actual bank statement/reference, exact amount, destination and currency, then reconciles it internally. Never resend a transfer merely because internal confirmation failed.
- [ ] Reconcile daily: captured funds, verified refunds, COD custody/receipt, seller held/eligible/reserved/settled, receipt claims, bank statement and provider records. Review historical exceptions and pagination coverage separately from v2 reconciliation.
- [ ] Monitor unconfigured policies, invalid amounts, stale previews, duplicate-reference conflicts, negative held debt, refund obligations, orphaned postings, reserved requests awaiting review and external transfers awaiting internal confirmation. Assign owners and response times.

## Rollback, quarantine and recovery

- [ ] Stop new operations via an explicitly authorized gate change; preserve snapshots, approvals, evidence, event keys, receipts and ledger.
- [ ] Quarantine a suspect batch/request and block further release/settlement while investigating. Do not edit/delete original entries or remove a receipt claim to permit another transfer.
- [ ] Prepare reviewed compensating entries with original entry IDs, batch/event references, exact approved delta, actor/reviewer and reason; post transactionally under seller fences. Verify balances and reconciliation before resuming.
- [ ] If cash already moved externally, reconcile any bank return/reversal separately. Deleting a database record cannot reverse a transfer. Never create a fictional success/reversal event.
- [ ] Rehearse backup restore and ledger replay/reporting in isolation; ensure replay never reissues provider operations.

No automated Seller bank transfer or payout webhook lifecycle is implemented or claimed. Production readiness requires the completed checklist and accountable financial approval, not a passing build alone.
