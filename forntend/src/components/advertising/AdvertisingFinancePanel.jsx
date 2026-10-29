import React,{useEffect,useState} from 'react';
import {advertisingApi,advertisingMoney} from './advertisingApi';
import AdvertisingBillingPanel from './AdvertisingBillingPanel';
export default function AdvertisingFinancePanel({permissions,capabilities}){
  const [data,setData]=useState(null),[page,setPage]=useState(1),[error,setError]=useState(''),[id,setId]=useState(null),[refresh,setRefresh]=useState(0);
  useEffect(()=>{let alive=true;setError('');advertisingApi(true,`/finance?page=${page}&limit=20`).then(b=>alive&&setData(b.data)).catch(e=>alive&&setError(e.message));return()=>{alive=false;};},[page,refresh]);
  return <section className="ad-card"><h3>Advertising finance and reconciliation</h3><button onClick={()=>setRefresh(n=>n+1)}>Refresh advertising finance</button>{error&&<p role="alert">{error}</p>}
    {data&&<><p>Collections: {advertisingMoney(data.totals.receivedPaise)} · refunds: {advertisingMoney(data.totals.refundedPaise)} · recognized revenue: {advertisingMoney(data.totals.recognizedPaise)}</p>
      {data.refundQueue?.length>0&&<div className="ad-refund-queue" aria-label="Refunds waiting"><h4>Refunds waiting ({data.refundQueue.length})</h4>
        {data.refundQueue.map(c=><p key={c.id}>{c.name}: {c.reason==='CANCELLED'?'cancelled by the seller or Bulkimart':c.reason==='ADMIN_SUSPENDED'?'suspended':'stopped (products unavailable)'} · suggested {advertisingMoney(c.suggestedPaise)} of up to {advertisingMoney(c.remainingPaise)} <button onClick={()=>setId(c.id)}>Review refund</button></p>)}</div>}
      {data.authorizationQueue?.map(c=><p key={c.id}>{c.name}: financial authorization pending <button onClick={()=>setId(c.id)}>Review accepted campaign billing</button></p>)}
      <p>Gateway fees require separate provider-statement review; no expense or net settlement is assumed.</p>
      {data.discrepancies.map((d,i)=><p key={i}>Payment {d.paymentId}: {d.code}</p>)}
      {data.webhooks?.map(w=><p key={w._id}>Webhook {w.kind}: {w.stage} {w.code||''} · {new Date(w.processedAt).toLocaleString()}{w.stage==='INCIDENT'?' · Historical incident; reconcile the associated payment and review subsequent receipts.':''}</p>)}
      {data.rows.map(p=><article key={p.id}><p>{p.reference} · {p.status} · {advertisingMoney(p.amountPaise)} · {p.reconciliation||'Awaiting capture'}</p><button onClick={()=>setId(p.id)}>Open advertising transaction</button></article>)}
      <button disabled={page<=1} onClick={()=>setPage(n=>n-1)}>Previous finance page</button><span> Page {page} · {data.total} payments · {data.authorizationTotal||0} awaiting authorization · {data.webhookTotal||0} webhook records </span><button disabled={page*data.limit>=Math.max(data.total,data.authorizationTotal||0,data.webhookTotal||0)} onClick={()=>setPage(n=>n+1)}>Next finance page</button>
    </>}
    {id&&<AdvertisingBillingPanel key={id} id={id} admin permissions={permissions} capabilities={capabilities} onChanged={()=>setRefresh(n=>n+1)}/>}
  </section>;
}
