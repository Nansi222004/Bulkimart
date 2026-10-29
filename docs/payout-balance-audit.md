Payout balance audit — 29 October 2026

The configured database was inspected with raw Mongo reads only. No balance,
cash receipt, commission snapshot, payout or transfer was changed.

Observed causes

- Neelam store has three delivered orders totalling ₹2,050 in item sales. None
  has an original financial snapshot or seller earning entry. Sales revenue
  cannot establish the net payable without the original terms and funding proof.
- Always has seven delivered orders totalling ₹5,300 in item sales. Five orders
  have a frozen `held_missing_rule` snapshot (₹4,300 gross); two configured orders
  (₹1,000 gross) await COD receipt confirmation. There are no seller payable entries.
- Rider ending `4ea4` has ₹40 held in the ledger, no eligible ledger funds, and
  ₹200 in reported COD cash without admin receipt confirmation. Its older pending
  counter contains ₹256; that counter has no matching eligible earning entries.
- Rider ending `d900` has ₹140 eligible and ₹160 held. ₹1,010 COD cash remains
  outstanding, and a separate cash discrepancy is disputed. Those obligations
  prevent withdrawal even though the eligible earning amount is positive.
- The saved policy permits requests, with minimums of ₹500 for sellers and ₹100
  for riders. Neither rider has a pending payout request.

Local changes

- Admin now shows gross delivered sales lacking an earning entry, the affected
  order counts and the reason, separately from actual payable balances.
- The seller ledger list excludes entries without a seller, so platform service
  fees and rider/parcel entries do not appear as seller earnings.
- Rider eligibility is calculated from the verified ledger even when the profile
  workflow marker is absent. Legacy counters remain separate and unverified.
- Both eligibility and payout requests enforce COD receipt/dispute checks,
  including older COD records; the UI also explains pending requests, missing
  destinations, minimums and weekly scheduling.
- Earnings refreshes on entry, focus, COD settlement/payout alerts, cash report
  completion and the explicit Refresh payout status button.

Operational next steps

- In Finance Center → Orders & COD → COD cash, verify actual receipt against bank
  or hub evidence and reconcile the disputed amount. A rider's report alone does
  not prove Bulkimart received the cash.
- Review Neelam's old orders under Reports → Old orders using the original
  agreement, payment and COD evidence. This workflow prepares a reviewed batch,
  applies the approved earning entries and releases eligible funds.
- Always's missing-rule orders need original commission evidence reviewed by
  finance; saving a current commission rule does not rewrite those frozen orders.
- Once ledger funds are eligible and all blockers are cleared, seller/rider
  requests reserve funds once. Admin records a bank transfer only after it is made.

Validation uses synthetic records in a disposable database and intercepted browser
APIs. It does not transfer money or confirm receipt of real COD cash.

Validation result: 150 backend finance tests and 95 frontend checks passed across
the affected suites, including COD confirmation, missing workflow markers,
legacy custody, minimums, concurrent payout reservations and UI eligibility
refresh. The frontend production build and diff whitespace check passed.
The browser layout runner could not complete: both Chrome and Edge timed out
on the initial DevTools `Page.enable` command, before opening the app. Browser
layout verification therefore remains outstanding. Changes are not deployed.
