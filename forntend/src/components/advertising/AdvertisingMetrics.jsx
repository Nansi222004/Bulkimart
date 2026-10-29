import React,{useEffect,useState} from 'react';
import {advertisingApi} from './advertisingApi';
const day=d=>new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short'});
// Views and clicks for one campaign. Sellers see three plain figures; admins also see the paid and
// free-pilot split, the counting window and the server's note.
export default function AdvertisingMetrics({id,admin=false}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  useEffect(()=>{let alive=true;setData(null);setError('');advertisingApi(admin,`/campaigns/${id}/analytics`).then(b=>alive&&setData(b.data)).catch(e=>alive&&setError(e.message));return()=>{alive=false;};},[id,admin,refresh]);
  const count=(mode,type)=>data?.rows.find(r=>r.mode===mode&&r.type===type)?.count||0;
  const pilotUsed=count('NON_BILLABLE_PILOT','IMPRESSION')||count('NON_BILLABLE_PILOT','CLICK');
  const modes=admin||pilotUsed?['PAID_CATEGORY','NON_BILLABLE_PILOT']:['PAID_CATEGORY'];
  return <section className="ad-card ad-metrics-card" aria-label="Views and clicks">
    <div className="ad-pay-head"><h3>Views and clicks</h3><button type="button" onClick={()=>setRefresh(n=>n+1)}>Refresh</button></div>
    {error&&<p role="alert" className="ad-error">{error}</p>}
    {!data&&!error&&<p role="status">Loading…</p>}
    {data&&modes.map(mode=>{const views=count(mode,'IMPRESSION'),clicks=count(mode,'CLICK');
      return <div key={mode}>
        {modes.length>1&&<p className="ad-metrics-mode">{mode==='PAID_CATEGORY'?'Paid ad':'Free trial run'}</p>}
        <div className="ad-metrics-tiles">
          <div><strong>{views}</strong><span>Views</span></div>
          <div><strong>{clicks}</strong><span>Clicks</span></div>
          <div><strong>{views?`${(clicks/views*100).toFixed(1)}%`:'—'}</strong><span>Click rate</span></div>
        </div>
      </div>;})}
    {data&&<p className="ad-metrics-note">{admin
      ?<>{new Date(data.from).toLocaleString()} – {new Date(data.to).toLocaleString()}. Retention: {data.retentionDays?`${data.retentionDays} days`:'not configured'}. {data.note}</>
      :<>Counted {day(data.from)} – {day(data.to)}. A view counts when your product is on screen for at least a second.</>}</p>}
  </section>;
}
