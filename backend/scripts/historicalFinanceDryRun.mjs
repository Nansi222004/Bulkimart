// Offline by default and by design: reads only a saved sanitized audit export.
// No environment loading, database connection, provider or apply import.
import fs from 'node:fs/promises';
import { historicalManifestRow } from '../utils/historicalManifest.js';

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output || process.argv.includes('--apply')) throw new Error('Usage: node scripts/historicalFinanceDryRun.mjs <saved-evidence.json> <manifest.json>; apply is not supported');
const evidence = JSON.parse(await fs.readFile(input, 'utf8'));
const rows = evidence.orders.flatMap(order => order.items.map(item => historicalManifestRow({ order, item,
  payment: evidence.payments.find(row => String(row._id) === String(order.paymentId)),
  deliveries: (evidence.deliveries || []).filter(row => String(row.orderId) === String(order._id)),
  returns: (evidence.returns || []).filter(row => String(row.orderId) === String(order._id)),
  entries: (evidence.ledgerEntries || []).filter(row => String(row.orderId) === String(order._id)), policies: evidence.commissions || [], payouts: evidence.payouts || [],
})));
await fs.writeFile(output, JSON.stringify({ manifestVersion: 1, mode: 'dry-run', sourceObservedAt: evidence.observedAt, mutations: 0, rows }, null, 2));
console.log(JSON.stringify({ mode: 'dry-run', rows: rows.length, mutations: 0 }));
