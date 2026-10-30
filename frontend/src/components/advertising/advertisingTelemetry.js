import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';
export function sendAdEvent(token,type) {
  if(!token)return;
  try { void boundedFetch(apiUrl('/api/advertising/events'),{method:'POST',headers:{'Content-Type':'application/json'},
    credentials:'omit',keepalive:true,body:JSON.stringify({token,type})},2000).catch(()=>{}); }catch{ /* Navigation is independent. */ }
}
// At least 50% of a card continuously visible for 1 second, in a visible page.
// This is client-reported viewability, not proof that a human viewed the card.
export function observeAdImpressions(container,rows,send=sendAdEvent,platform=globalThis) {
  if(!container||typeof platform.IntersectionObserver!=='function'||!platform.document)return ()=>{};
  const visible=new Map(),timers=new Map(),sent=new Set();
  const stop=node=>{if(timers.has(node))platform.clearTimeout(timers.get(node));timers.delete(node);};
  const start=(node,index)=>{
    if(platform.document.visibilityState!=='visible'||timers.has(node)||sent.has(index)||!rows[index]?.serveToken)return;
    timers.set(node,platform.setTimeout(()=>{
      timers.delete(node);
      if(platform.document.visibilityState==='visible'&&visible.has(node)&&!sent.has(index)){
        sent.add(index);send(rows[index].serveToken,'IMPRESSION');observer.unobserve(node);
      }
    },1000));
  };
  const observer=new platform.IntersectionObserver(entries=>{
    for(const entry of entries){const index=Number(entry.target.dataset.adIndex);
      if(entry.isIntersecting&&entry.intersectionRatio>=0.5){visible.set(entry.target,index);start(entry.target,index);}
      else{visible.delete(entry.target);stop(entry.target);}
    }
  },{threshold:[0,0.5,1]});
  const visibility=()=>{for(const node of timers.keys())stop(node);if(platform.document.visibilityState==='visible')for(const [node,index]of visible)start(node,index);};
  for(const node of container.querySelectorAll('[data-ad-index]'))observer.observe(node);
  platform.document.addEventListener('visibilitychange',visibility);
  return ()=>{observer.disconnect();for(const node of timers.keys())stop(node);platform.document.removeEventListener('visibilitychange',visibility);};
}
