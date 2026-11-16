import { Building2, Factory, FileText, ReceiptIndianRupee, Scale, Stamp, Utensils } from 'lucide-react';

// A picture for each kind of legal service, picked from its name (same rules as the customer app).
export function serviceIcon(name = '') {
  const n = name.toLowerCase();
  if (/trademark|brand|logo/.test(n)) return Stamp;
  if (/private limited|llp|company|incorporat|partnership/.test(n)) return Building2;
  if (/fssai|food/.test(n)) return Utensils;
  if (/msme|udyam|factory|shop act/.test(n)) return Factory;
  if (/gst|tax|itr|account/.test(n)) return ReceiptIndianRupee;
  if (/agreement|deed|contract|affidavit/.test(n)) return FileText;
  return Scale;
}

// ₹8,258.82 — Indian digit grouping, always two decimals.
export const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
