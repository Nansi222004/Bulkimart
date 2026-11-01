# Security Validation Report

**Status: not executed.** The 64 cases in `SECURITY_TEST_CASES.md` and the 7-step regression suite need (a) a trusted machine, (b) a staging backend, and (c) the R1–R7 backend changes implemented behind flags. None of these exist yet: the security gate failed (`FINAL_FEATURE_AUDIT.md` §1), and backend changes are not authorised on an untrusted machine.

Re-checked 2026-11-01 (Stage 7): unchanged. All 64 cases remain **NOT RUN**. Stage 7 adds two seller routes to cover once testing starts: wholesale pricing (another seller's product → 404; Wholesale channel not approved → 403 when enabling; stale `version` → 409) and campaign analytics (another seller's campaign → 404).

## Case status

| Group | Cases | Status |
|---|---|---|
| R1 Onboarding authorization | 12 | Not run — backend change not implemented (gate) |
| R2 Bank details | 13 | Not run — not implemented (gate) |
| R3 Private storage | 11 | Not run — not implemented (gate) |
| R4 Data minimisation | 10 | Not run — not implemented (gate) |
| R5 Identity honesty | 5 | Not run (R5-01 web copy: not implemented; frontend change outside `mobile-seller/`) |
| R6 Duplicate documents | 7 | Not run — not implemented (gate) |
| R7 Product endpoints | 6 | Not run — not implemented (gate) |
| Regression REG-01…07 | 7 | Not run |

No case is marked Passed and no exception has been approved.

## App-side protections in place (static, untested)

| Protection | Where |
|---|---|
| Onboarding shown only to `none`/`incomplete` sellers; rejected/approved never reach it | `AuthContext`, `RootNavigator` |
| Completed onboarding steps not re-sent (avoids R6 duplicates) | `OnboardingScreen` |
| Bank/KYC read-only; account, PAN and UPI masked; KYC images never opened | `KycDetailsScreen` |
| Token in Keychain; 401 for the current token ends the session; push token removed at logout | `storage.js`, `apiClient.js`, `AuthContext` |
| Payout idempotency; campaign request keys | `finance.js`, `CampaignBuilderScreen` |
| Order actions only from `permittedActions` | `OrderDetailScreen` |
| Debug builds cannot call production (fail closed without a staging URL) | `config/env.js`, `apiClient.js` |
| Permissions requested only on use (camera, notifications, location) | `media.js`, `push.js`, `location.js` |

## Environment and account findings (for the owner)

1. The development machine is still infected (persistence files present, a live payload in `safe-fire`, a detection today).
2. The Claude Code session's account identity changed several times during this work. Verify access to this machine and to the accounts involved, and rotate credentials from a clean device.
3. Backend risks R1–R7 remain open in production code.
