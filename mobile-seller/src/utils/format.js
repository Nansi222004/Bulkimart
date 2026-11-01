// Display formatting only. Nothing here calculates, rounds or derives an amount.
// Each helper matches the web component that shows the same figure.

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

// Rupee amounts with 2 decimals (web: sellerFinanceRead.sellerMoney). Missing values show as '—', never ₹0.
export const money = (value) =>
  finite(value)
    ? `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

// Dashboard KPI (web: DashboardTab). null = the server hasn't calculated it yet.
// A missing (undefined) or non-numeric value shows '—'. The web shows ₹0 here; the app deliberately doesn't.
export const kpiMoney = (value) =>
  value === null
    ? 'Pending calculation'
    : finite(value)
      ? `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '—';

// Order list amounts (web: OrdersTab money()). Missing → '—', never ₹0.
export const orderMoney = (value) => (finite(value) ? `₹${value.toLocaleString('en-IN')}` : '—');

// Counts from the server (orders, products). Missing → '—'.
export const countText = (value) => (Number.isSafeInteger(value) ? String(value) : '—');

// Order detail rows (web: orderDetailSections money()).
export const detailMoney = (value) =>
  value == null ? 'Not recorded' : `₹${Number(value).toLocaleString('en-IN')}`;

// Amounts the server returns in paise (financial breakdown, tax statement). Pure unit display.
export const paiseMoney = (paise) => (finite(paise) ? `₹${(paise / 100).toFixed(2)}` : '—');
export const paiseMoneyLocale = (paise) =>
  finite(paise)
    ? `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

export const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';

export const fullDate = (value) => (value ? new Date(value).toLocaleString('en-IN') : 'Not recorded');

export const statusText = (value) =>
  String(value || 'Not recorded').replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase());

export const titleCase = (value) =>
  String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const addressText = (address) =>
  address
    ? [...new Set([address.name, address.house, address.building, address.line1, address.address, address.line2,
      address.locality, address.city, address.state, address.pincode || address.pin_code].filter(Boolean))].join(', ')
    : 'Not recorded';

export const monthName = (month) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
