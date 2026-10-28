# Admin service notifications — 29 October 2026

A read-only audit of recent service applications confirmed stored admin notifications, including unread notifications, for customer requests and seller applications. One active admin was present. No test notifications were sent to that account.

The admin UI previously incremented its badge on a socket signal without reloading the open inbox. It did not reconcile after reconnecting, and inbox HTTP failures were logged without a visible retry. Paid customer requests also used the seller-application link.

The admin notification hook now reloads the authenticated inbox and unread count on a live signal, displays a foreground service alert, deduplicates repeated alerts, and reconciles on reconnect, window focus, returning online and a 30-second visible-tab fallback. Stale responses and changed sessions cannot replace newer inbox data. Read failures show a retry. Mark-as-read updates the UI after server confirmation.

New paid customer alerts and customer follow-ups link to Customer requests. Older generic links resolve the application type through the authenticated API before opening the appropriate workspace. No historical notification rows were rewritten.

Free services notify when submitted. Fixed-price services notify only once the fee is verified, as required by the existing submission workflow. Admin delivery here covers the persisted inbox, live in-app updates and foreground alerts.

Verification: 29 backend tests passed for legal services, service payments and actual notification persistence/fanout/authenticated admin reads using disposable MongoDB. Another 22 frontend tests passed for live inbox/count refresh, duplicate alerts, stale reads, reconnect/focus recovery, retry and both old/new customer links. The production build and whitespace check passed. No production requests, fees, notifications or other records were modified. Changes have not been deployed.

Repeat the read-only audit from `backend` with `node scripts/auditServiceNotificationsReadOnly.mjs`.
