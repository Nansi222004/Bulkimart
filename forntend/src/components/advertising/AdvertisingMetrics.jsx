import React,{useEffect,useState} from 'react';
import {advertisingApi} from './advertisingApi';
export default function AdvertisingMetrics({id,admin=false}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  useEffect(()=>{let alive=true;setData(null);advertisingApi(admin,`/campaigns/${id}/analytics`).then(b=>alive&&setData(b.data)).catch(e=>alive&&setError(e.message));return()=>{alive=false;};},[id,admin,refresh]);
  return <section className="ad-card"><h4>Impressions and clicks</h4><button onClick={()=>setRefresh(n=>n+1)}>Refresh campaign events</button>{error&&<p role="alert">{error}</p>}
    {data&&<><p>{new Date(data.from).toLocaleString()} – {new Date(data.to).toLocaleString()}. Retention: {data.retentionDays?`${data.retentionDays} days`:'not configured'}.</p>
      {['PAID_CATEGORY','NON_BILLABLE_PILOT'].map(mode=>{const impressions=data.rows.find(r=>r.mode===mode&&r.type==='IMPRESSION')?.count||0,clicks=data.rows.find(r=>r.mode===mode&&r.type==='CLICK')?.count||0;
        return <p key={mode}>{mode==='PAID_CATEGORY'?'Paid category':'Non-billable pilot'}: {impressions} qualified impressions · {clicks} valid submitted clicks · CTR {impressions?`${(clicks/impressions*100).toFixed(2)}%`:'unavailable'}</p>;})}<p>{data.note}</p>
    </>}
  </section>;
}
