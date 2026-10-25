import React from 'react';
const stage={payment_pending:['payment_started','Payment started'],payment_failed:['payment_failed','Payment not completed'],searching_for_driver:['partner_search','Finding a delivery partner'],needs_admin_assignment:['partner_search','Pickup is being arranged'],driver_assigned:['partner_assigned','Delivery partner assigned'],driver_arriving:['to_pickup','On the way to pickup'],arrived_at_pickup:['at_pickup','Arrived at pickup'],picked_up:['collected','Parcel collected'],in_transit:['in_transit','On the way to delivery'],arrived_at_dropoff:['at_dropoff','Arrived at delivery address'],delivered:['delivered','Parcel delivered'],cancellation_review:['cancel_review','Cancellation requested'],cancelled:['cancelled','Booking cancelled'],delivery_failed:['needs_help','Support is helping with the delivery']};
export function summarizeParcelUpdates(events=[]) {
  const milestones=new Map();
  for(const event of events){
    if(['pickup_code','delivery_code','payment_initiated'].includes(event.action))continue;
    const entry=event.action==='terms_accepted'?['booking','Booking created']:event.action==='payment_verified'?['payment','Payment confirmed']:event.action==='cash_collected'?['cash','Cash payment recorded']:stage[event.status];
    if(!entry)continue;
    const [key,title]=entry;
    milestones.set(key,{key,title,at:event.at});
  }
  // Once payment is confirmed, an earlier request to complete it is irrelevant.
  if(milestones.has('payment'))milestones.delete('payment_started');
  return [...milestones.values()].sort((a,b)=>new Date(a.at)-new Date(b.at));
}
const timestamp=value=>Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'Time unavailable';
function UpdateList({items}) {return <ol className="parcel-update-list">{items.map(item=><li key={item.key}><span className="parcel-update-dot" aria-hidden="true"/><div><strong>{item.title}</strong><time dateTime={item.at}>{timestamp(item.at)}</time></div></li>)}</ol>;}
export default function ParcelUpdates({events=[]}) {
  const items=summarizeParcelUpdates(events),recent=items.slice(-4).reverse(),earlier=items.slice(0,-4).reverse();
  return <div className="parcel-updates">{!items.length?<p>No delivery updates yet.</p>:<><p className="parcel-update-caption">Most recent first</p><UpdateList items={recent}/>{earlier.length>0&&<details className="parcel-earlier-updates"><summary>Earlier updates ({earlier.length})</summary><UpdateList items={earlier}/></details>}</>}</div>;
}
