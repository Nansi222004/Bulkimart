import '../config/bootstrap.js';
import mongoose from 'mongoose';
import Service from '../models/Service.js';
import { validateDefinition } from '../services/serviceForms.service.js';
import { serviceFeeQuote } from '../services/servicePayment.service.js';

/**
 * Creates the business compliance services as DRAFTS, ready for an admin to review
 * and publish in Admin → Services. Prices, the GST rate, the cancellation window and
 * the terms below are only starting values: every one is an ordinary per-service
 * setting the admin can change afterwards. Existing services (same identifier) are
 * never modified.
 *
 *   node scripts/seedComplianceServices.mjs           # dry run: shows what would be created
 *   node scripts/seedComplianceServices.mjs --apply   # creates the missing services as drafts
 */
const apply = process.argv.includes('--apply');

const STARTING_GST_RATE = 18;          // editable per service in Admin
const STARTING_CANCELLATION_HOURS = 24; // editable per service in Admin
const TERMS = 'Total service fee is payable to Bulkimart for professional compliance assistance, exclusive of applicable GST shown above. '
  + 'While preliminary setup can be initiated beforehand, active backend processing will only commence after successful payment verification. '
  + 'Cancellation requests must be made at least 24 hours before the service process officially starts; no refunds are applicable once processing has commenced. '
  + 'Availing this service does not guarantee final government approval, as approval is subject strictly to statutory authority verification. '
  + 'Contact Bulkimart for review.';

// The applicant details every compliance request needs.
const FIELDS = [
  { id: 'fullName', type: 'text', label: 'Full name', required: true, help: 'As on your PAN or ID proof.', maxLength: 150 },
  { id: 'businessName', type: 'text', label: 'Business / trade name', required: false, help: 'Leave blank if not applicable.', maxLength: 200 },
  { id: 'whatsappNumber', type: 'phone', label: 'WhatsApp mobile number', required: true, help: 'Our compliance team will contact you on this number.' },
  { id: 'email', type: 'email', label: 'Email address', required: true, help: '' },
  { id: 'location', type: 'text', label: 'City / State', required: true, help: 'For example: Indore, Madhya Pradesh', maxLength: 150 },
];

const SERVICES = [
  ['gst-registration-assistance', 'GST Registration Assistance', 2000, 'Portal filing, document review & ARN tracking support.'],
  ['gst-return-filing', 'Monthly / Quarterly GST Filing', 999, 'GSTR-1 & GSTR-3B return filing and reconciliation.'],
  ['individual-itr-filing', 'Individual ITR Filing', 999, 'ITR-1 to ITR-4 preparation and e-filing for individuals.'],
  ['business-itr-filing', 'Business ITR Filing', 2499, 'ITR-3 / ITR-4 / ITR-5 return filing for proprietorships & firms.'],
  ['msme-udyam-registration', 'MSME / Udyam Registration', 999, 'Category classification and Udyam certificate issuance.'],
  ['fssai-basic-registration', 'FSSAI Basic Registration', 1499, 'Food business operator license application & guidance.'],
  ['trademark-filing-assistance', 'Trademark Filing Assistance', 3499, 'Brand name/logo search, class identification & filing.'],
  ['private-limited-llp-setup', 'Private Limited / LLP Setup', 6999, 'Incorporation documentation, DIN/DSC assistance & filing.'],
].map(([slug, name, amount, description]) => validateDefinition({
  slug, name, description,
  instructions: 'Fill in your details and pay the service fee. Our compliance team will contact you on WhatsApp for the documents needed.',
  audiences: ['customer'], legalCategory: 'Business compliance',
  pricing: { mode: 'fixed', amount, currency: 'INR', taxRate: STARTING_GST_RATE },
  terms: TERMS, cancellationWindowHours: STARTING_CANCELLATION_HOURS, fields: FIELDS,
}));

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
  const existing = new Set((await Service.find({ slug: { $in: SERVICES.map(s => s.slug) } }).select('slug').lean()).map(s => s.slug));
  for (const service of SERVICES) {
    const q = serviceFeeQuote(service);
    const line = `${service.name.padEnd(32)} ₹${(q.basePaise / 100).toFixed(2)} + GST ₹${(q.taxPaise / 100).toFixed(2)} = ₹${(q.amountPaise / 100).toFixed(2)}`;
    if (existing.has(service.slug)) { console.log(`skip (already exists)  ${line}`); continue; }
    if (apply) { await Service.create({ ...service, status: 'draft' }); console.log(`created draft          ${line}`); }
    else console.log(`would create draft     ${line}`);
  }
  if (!apply) console.log('\nDry run only. Re-run with --apply to create the drafts, then review and publish them in Admin → Services.');
} finally { await mongoose.disconnect(); }
