// Small helpers shared by the Services tab and the legal service page (same rules as the website).
import { Building2, Factory, FileText, ReceiptIndianRupee, Scale, Stamp, Utensils } from 'lucide-react-native';

// A picture for each kind of legal service, picked from its name.
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

// ₹8,258.82 — Indian digit grouping, two decimals.
export const rupees = paise => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A soft wash of a theme colour over a base colour (the website uses CSS color-mix for the same tint).
export function blend(hex, base, amount) {
  const rgb = v => { const h = String(v || '').replace('#', ''); const f = h.length === 3 ? h.split('').map(x => x + x).join('') : h; const n = parseInt(f, 16); return Number.isFinite(n) && f.length === 6 ? [n >> 16, (n >> 8) & 255, n & 255] : null; };
  const a = rgb(hex), b = rgb(base) || [255, 255, 255];
  if (!a) return base;
  return '#' + a.map((x, i) => Math.round(b[i] + (x - b[i]) * amount).toString(16).padStart(2, '0')).join('');
}
