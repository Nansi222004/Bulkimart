import HistoricalFinancePanel from './HistoricalFinancePanel';
import React, { useEffect, useState } from 'react';
import FinanceWorkflowTab from './FinanceWorkflowTab';
import DeliveryRatesTab, { CustomerDeliveryChargeCard } from './DeliveryRatesTab';
import QuickThirdPartySettingsTab from './QuickThirdPartySettingsTab';
import SellerLedgerAdminTab from './SellerLedgerAdminTab';
import FinanceOverview from './FinanceOverview';
import FinancePolicySettings from './FinancePolicySettings';
import { TaxReportPanel, AccountingExportPanel } from './FinanceReports';
import './FinanceCenter.css';

export const financeAreas = {
  overview: { label: 'Overview', description: 'What needs your attention and where the money stands.', views: [['overview', 'Overview']] },
  orders: { label: 'Orders & COD', description: 'Each order’s money breakdown. Earnings move on their own; only orders that need you are flagged.', views: [['orders', 'All orders'], ['cod', 'COD cash']] },
  payouts: { label: 'Payouts', description: 'What Bulkimart owes sellers and riders, and the payout requests to pay.', views: [['seller-payouts', 'Seller payouts'], ['earnings', 'Seller balances'], ['payouts', 'Rider payouts'], ['rider-earnings', 'Rider balances'], ['courier-payments', 'Shiprocket fee payments']] },
  settings: { label: 'Settings', description: 'Rates and rules. Every change is saved as a new version with your reason; past orders keep their old rates.', views: [['commissions', 'Commission'], ['rates', 'Rider pay'], ['charges', 'Customer delivery charge'], ['shiprocket', 'Shiprocket fee'], ['policies', 'Payouts & tax']] },
  reports: { label: 'Reports', description: 'The full ledger, automatic checks, tax and accounting exports, and orders placed before the finance system started.', views: [['ledger', 'Ledger & checks'], ['tax', 'Tax reports'], ['accounting', 'Accounting export'], ['historical', 'Old orders']] },
};

export const legacyFinanceViews = {
  'app-settings': 'commissions', 'finance-operations': 'overview',
  'quick-third-party-settings': 'shiprocket', 'delivery-rates': 'rates',
  'vendor-earnings': 'earnings', 'vendor-payouts': 'seller-payouts', payouts: 'seller-payouts',
  'delivery-earnings': 'rider-earnings', 'rider-payouts': 'payouts',
};

const areaOf = view => Object.keys(financeAreas).find(id => financeAreas[id].views.some(([value]) => value === view));

// A view name is unique across areas, so old links (?area=cod&view=ledger)
// still land on the right section after the areas were regrouped.
export function readFinanceLocation(legacyTab) {
  const query = new URLSearchParams(window.location.search);
  const view = query.get('view'), area = query.get('area');
  if (view && areaOf(view)) return [areaOf(view), view];
  if (financeAreas[area]) return [area, financeAreas[area].views[0][0]];
  const fallback = legacyFinanceViews[legacyTab] || 'overview';
  return [areaOf(fallback), fallback];
}

export default function FinanceCenter({ legacyTab }) {
  const [[area, view], setLocation] = useState(() => readFinanceLocation(legacyTab));
  useEffect(() => { const update = () => setLocation(readFinanceLocation(legacyTab)); update(); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, [legacyTab]);
  const navigate = (nextArea, nextView = financeAreas[nextArea].views[0][0]) => { window.history.pushState(null, '', '/admin/finance-center?' + new URLSearchParams({ area: nextArea, view: nextView })); setLocation([nextArea, nextView]); window.dispatchEvent(new Event('popstate')); };
  const go = nextView => navigate(areaOf(nextView), nextView);
  let content;
  if (view === 'overview') content = <FinanceOverview onNavigate={go} />;
  else if (view === 'historical') content = <HistoricalFinancePanel />;
  else if (view === 'tax') content = <TaxReportPanel />;
  else if (view === 'accounting') content = <AccountingExportPanel />;
  else if (view === 'rates') content = <DeliveryRatesTab includeCustomer={false} />;
  else if (view === 'charges') content = <CustomerDeliveryChargeCard />;
  else if (view === 'shiprocket' || view === 'courier-payments') content = <QuickThirdPartySettingsTab view={view === 'shiprocket' ? 'settings' : 'records'} />;
  else if (view === 'earnings' || view === 'seller-payouts') content = <SellerLedgerAdminTab view={view === 'earnings' ? 'earnings' : 'payouts'} />;
  else if (view === 'policies') content = <FinancePolicySettings />;
  else content = <FinanceWorkflowTab initialTab={view === 'rider-earnings' ? 'ledger' : view} hideNavigation account={view === 'rider-earnings' ? 'rider_payable' : ''} />;
  const sections = financeAreas[area].views;
  return <main className="finance-center finance-workflow">
    <header className="finance-center-header"><h1>Finance Center</h1><p>{financeAreas[area].description}</p></header>
    {legacyTab === 'app-settings' && <p className="finance-notice">Financial settings now live here. Other app settings are not part of Finance.</p>}
    <nav aria-label="Finance Center areas" className="finance-area-nav">{Object.entries(financeAreas).map(([id, item]) => <button key={id} type="button" aria-pressed={area === id} onClick={() => navigate(id)}>{item.label}</button>)}</nav>
    {sections.length > 1 && <nav aria-label="Finance Center sections" className="finance-section-nav">{sections.map(([id, text]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => navigate(area, id)}>{text}</button>)}</nav>}
    <div key={view} className="finance-center-content">{content}</div>
  </main>;
}
