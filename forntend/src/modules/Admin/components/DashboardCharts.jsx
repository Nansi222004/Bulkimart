import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminGet } from '../../../utils/adminApi';
import { dashboardMoney, readDashboardFinance, readDashboardOrderAnalytics, dashboardStatusLabels, dashboardChannelLabels, dashboardSalesLabels } from '../utils/dashboardRead';
import './DashboardCharts.css';

// Text labels and exact values remain available without color, hover or SVG support.
export function DashboardBars({title, rows, formatValue = value => value.toLocaleString('en-IN')}) {
  const maximum = Math.max(0, ...rows.map(row => row.value));
  return <figure className="sa-dashboard-bars" aria-label={title}>
    <figcaption>{title} · bars share a zero baseline</figcaption>
    <ul>{rows.map((row, index) => <li key={row.key}>
      <div className="sa-dashboard-bar-label"><span>{row.label}</span><strong>{formatValue(row.value)}</strong></div>
      <div className="sa-dashboard-bar-track" title={`${row.label}: ${formatValue(row.value)}`}>
        <div className={`sa-dashboard-bar-fill ${index % 2 ? 'orange' : ''}`} style={{width:`${maximum ? row.value / maximum * 100 : 0}%`}} />
      </div>
    </li>)}</ul>
  </figure>;
}

export function FinancialOverviewChart({finance, error, loading, onRetry}) {
  let data;
  try { if (finance) data=readDashboardFinance(finance); } catch { /* Never plot a malformed amount. */ }
  const failed=!!error || (!!finance && !data);
  const rows=data ? [['orderValue','Gross completed order value'],['collections','Net verified external collections']]
    .filter(([key])=>data[key].status==='complete')
    .map(([key,label])=>({key,label,value:data[key].amountPaise})) : [];
  return <section className="sa-chart-card sa-dashboard-chart" aria-label="Revenue Overview">
    <h3 className="sa-card-title">Revenue Overview</h3>
    <p>All-time financial comparison · not a historical trend. Measures are not additive.</p>
    {loading ? <p role="status">Loading verified financial chart…</p> : failed || !data ? <div role="alert">
      <p>Financial chart unavailable. A verified response and finance permission are required.</p>
      <button onClick={onRetry}>Retry financial chart</button>
    </div> : <>
      {rows.length>0 && DashboardBars({title:'Order value and collections · INR',rows,formatValue:paise=>dashboardMoney(paise/100)})}
      {['orderValue','collections'].map(key => data[key].status!=='complete' && <p key={key} role="status">
        {key==='orderValue' ? 'Gross completed order value' : 'Net verified external collections'}: unavailable; {data[key].incompleteRecords} evidence issues.
        {' '}Verified records subtotal only: {dashboardMoney(data[key].verifiedSubtotalPaise/100)}.
      </p>)}
      <p>Order value is gross before subsequent item refunds; collections are net of verified refunds and exclude wallet transfers. Neither is platform revenue.</p>
      <p>Posted Bulkimart revenue: {data.platformRevenue.status==='unavailable' ? 'unavailable' : dashboardMoney(data.platformRevenue.verifiedSubtotalPaise/100)}.
        {data.platformRevenue.status==='incomplete' && ' Verified subtotal · reconciliation pending.'} {data.platformRevenue.blocker}</p>
      <p>{data.platformRevenue.basis || 'Net posted merchandise commission subtotal only'}: {dashboardMoney(data.platformRevenue.verifiedSubtotalPaise/100)}.
        {' '}{data.platformRevenue.incompleteRecords} evidence issues.</p>
      <p>{data.orderValue.excludedRecords} order-value exclusions; {data.collections.excludedRecords} collection exclusions. Historical time series unavailable: event attribution and historical coverage are not approved.</p>
      <small>Financial snapshot observed {new Date(data.asOf).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} · Asia/Kolkata</small>
    </>}
  </section>;
}

export function OrderAnalyticsCharts() {
  const [data,setData]=useState(null), [loading,setLoading]=useState(true), [error,setError]=useState('');
  const epoch=useRef(0), active=useRef(null);
  const load=useCallback(async()=>{
    const generation=++epoch.current;
    active.current?.abort(); active.current=new AbortController();
    setData(null);setError('');setLoading(true);
    try {
      const response=await adminGet('/dashboard/order-analytics',{signal:active.current.signal});
      const value=readDashboardOrderAnalytics(response.data);
      if (generation===epoch.current) setData(value);
    } catch {
      if (generation===epoch.current) setError('Order analytics could not be verified. Please retry.');
    } finally { if (generation===epoch.current) setLoading(false); }
  },[]);
  useEffect(()=>{
    void load();
    const sessionChanged=()=>{epoch.current++;active.current?.abort();setData(null);setLoading(false);setError('Admin session changed. Sign in again to view analytics.');};
    window.addEventListener('bulkimart:admin-session-changed',sessionChanged);
    return ()=>{epoch.current++;active.current?.abort();window.removeEventListener('bulkimart:admin-session-changed',sessionChanged);};
  },[load]);
  return <>{[
    ['Orders Performance','statuses',dashboardStatusLabels,'Current status distribution; not a delivery trend or success rate.'],
    ['Orders by Channel','channels',dashboardChannelLabels,'Stored Order.type; retail/wholesale is a separate classification.'],
  ].map(([title,key,labels,description])=><section key={key} className="sa-chart-card sa-dashboard-chart" aria-label={title}>
    <h3 className="sa-card-title">{title}</h3><p>{description}</p>
    {loading ? <p role="status">Loading order analytics…</p> : error || !data ? <div role="alert"><p>{error || 'Order analytics unavailable.'}</p><button onClick={load}>Retry order analytics</button></div> : <>
      <p>All-time · {data.totalOrders.toLocaleString('en-IN')} distinct fulfilment Orders</p>
      {data.totalOrders===0 ? <p role="status">No fulfilment Orders found.</p> : DashboardBars({title:`${title} · order counts`,rows:data[key].map(row=>({...row,label:labels[row.key],value:row.count}))})}
      {key==='channels' && <p>Separate sales classification: {data.salesChannels.length ? data.salesChannels.map(row=>`${dashboardSalesLabels[row.key]}: ${row.count.toLocaleString('en-IN')}`).join(' · ') : 'No Orders'}.</p>}
      <small>Operational observation {new Date(data.asOf).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} · Asia/Kolkata; separate from financial snapshot.</small>
      <button onClick={load}>Refresh order analytics</button>
    </>}
  </section>)}</>;
}
