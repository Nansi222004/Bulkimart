/**
 * One import that makes a standalone script able to reach the database.
 *
 * Two things have to happen before anything touches Mongo, and getting either
 * half wrong fails in a way that does not look like the real cause:
 *
 *  1. Load .env. Several modules read process.env at import time (the Cloudinary
 *     service calls config() at module scope), so this must run before they are
 *     evaluated — which, with hoisted ES imports, means importing this first.
 *
 *  2. Point DNS at a public resolver. Windows hands Node the local router as its
 *     resolver (often fe80::1), and consumer routers routinely refuse SRV record
 *     queries. Since `mongodb+srv://` connection strings are resolved through an
 *     SRV lookup, the connection dies with:
 *
 *       querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net
 *
 *     which reads like the cluster is unreachable or the credentials are wrong.
 *     It is neither: the DNS question was never allowed to leave the house.
 *
 * This used to be copy-pasted into every seed script, and the copy was easy to
 * forget — a new script would connect fine on Linux or CI and fail only on a
 * Windows dev machine, with an error pointing nowhere near the real problem.
 *
 * Usage — first line of any entrypoint that talks to Mongo:
 *
 *   import '../config/bootstrap.js';
 */

import './environment.js';
import { setServers } from 'dns';

// Development only. A production host has a working resolver of its own, and
// overriding it there would route the app's DNS through a third party.
if (process.env.NODE_ENV === 'development') {
  setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}
