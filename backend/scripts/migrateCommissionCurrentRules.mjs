// Explicit maintenance tool. Never imported by API boot. Reports by default.
// Moves merchandise commission from date-selected versions to one current
// rule per scope. With --apply it writes only `commission_current_rules`
// pointers; `commissions` history and every placed order are left untouched.
import mongoose from 'mongoose';
import { bootstrapCurrentCommissionRules } from '../services/vendorCommission.service.js';

const uri = process.env.MONGO_URI;
if (!uri) throw new Error('Supply the explicitly approved target MONGO_URI; no default database is used');
const apply = process.argv.includes('--apply');
if (apply && !process.env.FINANCE_COMMISSION_MIGRATION_APPROVAL?.trim()) throw new Error('FINANCE_COMMISSION_MIGRATION_APPROVAL is required to apply');
await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
try {
  const result = await bootstrapCurrentCommissionRules({ apply });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...result }, null, 2));
  if (result.futureVersions.length) console.warn(`${result.futureVersions.length} future-dated version(s) were not made current; re-enter them in Finance Center when they should start.`);
} finally {
  await mongoose.disconnect();
}
