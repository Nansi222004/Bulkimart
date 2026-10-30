// Request a fresh device fix on every heartbeat; never relabel old GPS as fresh.
// `refresh()` is the rider's own tap: it restarts a request that is still
// waiting instead of silently doing nothing, and `onPendingChange` lets the
// screen show that an update is in progress.
export function startRiderPresence({geolocation, send, onError=()=>{}, onPendingChange=()=>{}, intervalMs=60000,gpsTimeoutMs=20000}) {
  let stopped=false,pending=false,deadline,requestNumber=0;
  const setPending=value=>{pending=value;onPendingChange(value);};
  const update=({force=false}={})=>{
    if(stopped||(pending&&!force))return;
    if(!geolocation){onError('Allow location access so nearby parcel offers can reach you.');return;}
    // A manual retry supersedes any request still waiting; its late answer is ignored.
    if(pending)clearTimeout(deadline);
    setPending(true);
    const current=++requestNumber;
    // Browsers may leave a permission prompt open beyond the GPS API timeout.
    // Release the pending request ourselves so retry and later heartbeats work.
    deadline=setTimeout(()=>{if(stopped||current!==requestNumber)return;requestNumber++;setPending(false);onError('Your location is taking too long. Allow location access and tap Update location.');},gpsTimeoutMs);
    geolocation.getCurrentPosition(async position=>{
      if(stopped||current!==requestNumber)return;
      clearTimeout(deadline);
      try{if(!stopped)await send({lat:position.coords.latitude,lng:position.coords.longitude,source:'gps'});}
      catch{if(!stopped)onError('Live location could not update. Check your connection.');}
      finally{if(current===requestNumber)setPending(false);}
    },error=>{
      if(stopped||current!==requestNumber)return;clearTimeout(deadline);setPending(false);
      onError(error?.code===1
        ? 'Location permission is blocked. Turn on location for this site in your browser or phone settings, then tap Update location.'
        : 'Allow location access so nearby parcel offers can reach you.');
    },{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  };
  update();const timer=setInterval(update,intervalMs);
  const stop=()=>{stopped=true;requestNumber++;clearTimeout(deadline);clearInterval(timer);};
  stop.refresh=()=>update({force:true});
  return stop;
}
