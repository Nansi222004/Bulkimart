import React from 'react';

// Plain-language wording shared by every finance screen. These are plain
// functions (not components) so the help text renders inline with its field.

export const hint = (text, example) => <small className="finance-hint">{text}{example ? <em> Example: {example}</em> : null}</small>;

export const rupeesFromPaise = paise => typeof paise === 'number' && Number.isFinite(paise)
  ? `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

export const COD_STATUS = {
  expected: 'Waiting for cash',
  collected: 'Rider has the cash',
  remittance_reported: 'Rider says handed over',
  verified: 'Cash received',
  allocated: 'Cash received',
  discrepancy: 'Amount mismatch',
  disputed: 'Disputed',
};

export const POSTING = { held: 'On hold (return window)', eligible: 'Available to pay', reversed: 'Fully refunded' };

export const BUCKET = { pending: 'Pending', held: 'On hold', eligible: 'Available to pay', reserved: 'Payout requested', settled: 'Paid' };

export const ACCOUNT = {
  seller_payable: 'Owed to seller', rider_payable: 'Owed to rider', commission_revenue: 'Bulkimart commission', tax_liability: 'GST on commission',
  tcs_liability: 'TCS withheld', tds_liability: 'TDS withheld', platform_discount_expense: 'Discounts paid by Bulkimart', cod_shortage_expense: 'COD shortages absorbed',
  cod_custody: 'COD cash with riders', cod_excess_liability: 'Extra COD cash received', customer_delivery: 'Customer delivery charges', merchandise_gross: 'Item sales (full price)',
};

export const EXCEPTION = {
  discount_funding_policy_missing: 'Old order: discount owner not set',
  commission_rule_missing: 'No commission rule when ordered',
  cod_unverified: 'COD cash not received yet',
  cash_discrepancy: 'Cash amount mismatch',
  allocation_not_posted: 'Earnings not added yet',
  needs_admin_review: 'Needs your review',
};

export const label = (map, value) => map[value] || String(value || '—').replaceAll('_', ' ');
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
