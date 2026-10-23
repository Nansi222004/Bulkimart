import HistoricalFinancePanel from './HistoricalFinancePanel';
import React, { useEffect, useState } from 'react';
import FinanceWorkflowTab from './FinanceWorkflowTab';
import DeliveryRatesTab, { CustomerDeliveryChargeCard } from './DeliveryRatesTab';
import QuickThirdPartySettingsTab from './QuickThirdPartySettingsTab';
import SellerLedgerAdminTab from './SellerLedgerAdminTab';
import './FinanceCenter.css';

export const financeAreas = {
  settings: { label: 'Financial Settings', description: 'Configure approved rules. Each form identifies whose money it affects.', views: [['commissions','Vendor Commission'],['rates','Delivery Partner Rates'],['charges','Customer Delivery Charges'],['shiprocket','Shiprocket Service Fees'],['policies','Tax and Settlement Policies']] },
  vendors: { label: 'Vendor Finance', description: 'Inspect frozen order breakdowns, seller balances and reviewed settlements.', views: [['orders','Commission history & orders'],['historical','Historical order exceptions'],['earnings','Seller earnings'],['seller-payouts','Seller payout requests'],['courier-payments','Shiprocket fee payments']] },
  delivery: { label: 'Delivery Finance', description: 'Review held, payable and reserved rider earnings separately from COD cash.', views: [['rider-earnings','Delivery partner earnings'],['payouts','Rider payouts'],['rider-rules','Rider earning rules']] },
  cod: { label: 'COD and Reconciliation', description: 'Expected amount → rider collects cash → handover reported → independent receipt verification → allocation → eligible seller and rider settlement.', views: [['cod','COD collection & remittance'],['ledger','Ledger & reconciliation exceptions']] },
};

export const legacyFinanceViews = {
  'app-settings':['settings','commissions'], 'finance-operations':['settings','commissions'],
  'quick-third-party-settings':['settings','shiprocket'], 'delivery-rates':['settings','rates'],
  'vendor-earnings':['vendors','earnings'], 'vendor-payouts':['vendors','seller-payouts'], payouts:['vendors','seller-payouts'],
  'delivery-earnings':['delivery','payouts'], 'rider-payouts':['delivery','payouts'],
};

export function readFinanceLocation(legacyTab) {
  const fallback = legacyFinanceViews[legacyTab] || ['settings','commissions'];
  const query = new URLSearchParams(window.location.search);
  const area = query.get('area') || fallback[0], view = query.get('view') || fallback[1];
  return financeAreas[area]?.views.some(([id])=>id===view) ? [area,view] : fallback;
}

export default function FinanceCenter({ legacyTab }) {
  const [[area,view],setLocation]=useState(()=>readFinanceLocation(legacyTab));
  useEffect(()=>{const update=()=>setLocation(readFinanceLocation(legacyTab));update();window.addEventListener('popstate',update);return()=>window.removeEventListener('popstate',update);},[legacyTab]);
  const navigate=(nextArea,nextView)=>{window.history.pushState(null,'','/admin/finance-center?'+new URLSearchParams({area:nextArea,view:nextView}));setLocation([nextArea,nextView]);window.dispatchEvent(new Event('popstate'));};
  let content;
  if(view==='historical')content=<HistoricalFinancePanel/>;
  else if(view==='rates' || view==='rider-rules')content=<DeliveryRatesTab includeCustomer={false}/>;
  else if(view==='charges')content=<CustomerDeliveryChargeCard/>;
  else if(view==='shiprocket' || view==='courier-payments')content=<QuickThirdPartySettingsTab view={view==='shiprocket'?'settings':'records'}/>;
  else if(view==='earnings' || view==='seller-payouts')content=<SellerLedgerAdminTab view={view==='earnings'?'earnings':'payouts'}/>;
  else if(view==='policies')content=<section className="finance-panel"><h2>Tax and Settlement Policies</h2><p>Commission tax and Shiprocket service-fee tax are configured with their own rules. There is no standalone backend editor for general tax, return holds, shortage write-offs, bonuses or settlement schedules.</p><p>Status: Pending approval. These policies require business and release approval; this page does not create a new settings store.</p><button onClick={()=>navigate('settings','commissions')}>Configure commission tax</button><button onClick={()=>navigate('settings','shiprocket')}>Configure service-fee tax</button></section>;
  else content=<FinanceWorkflowTab initialTab={view==='rider-earnings'?'ledger':view} hideNavigation account={view==='rider-earnings'?'rider_payable':''}/>;
  return <main className="finance-center finance-workflow">
    <header className="finance-center-header"><p>SUPER ADMIN · FINANCE</p><h1>Finance Center</h1><p>Approved rules, financial activity and reconciliation in one place.</p></header>
    {legacyTab==='app-settings' && <p className="finance-notice">App Settings compatibility entry: financial settings are available here. Unrelated application settings remain unimplemented.</p>}
    <nav aria-label="Finance Center areas" className="finance-area-nav">{Object.entries(financeAreas).map(([id,item])=><button key={id} type="button" aria-pressed={area===id} onClick={()=>navigate(id,item.views[0][0])}>{item.label}</button>)}</nav>
    <p>{financeAreas[area].description}</p>
    {area==='cod' && <aside className="finance-notice">Delivery alone does not prove payment. A rider report records custody; independent verification establishes platform receipt. Missing, disputed, short and excess cash remain visible. The entire COD amount is not Bulkimart revenue.</aside>}
    <nav aria-label="Finance Center sections">{financeAreas[area].views.map(([id,label])=><button key={id} type="button" aria-pressed={view===id} onClick={()=>navigate(area,id)}>{label}</button>)}</nav>
    <div key={view} className="finance-center-content">{content}</div>
  </main>;
}
