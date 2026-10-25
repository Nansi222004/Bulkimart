// Request a fresh device fix on every heartbeat; never relabel old GPS as fresh.
export function startRiderPresence({geolocation, send, onError=()=>{}, intervalMs=60000,gpsTimeoutMs=20000}) {
  let stopped=false,pending=false,deadline,requestNumber=0;
  const update=()=>{
    if(stopped||pending)return;
    if(!geolocation){onError('Allow location access so nearby parcel offers can reach you.');return;}
    pending=true;
    const current=++requestNumber;
    // Browsers may leave a permission prompt open beyond the GPS API timeout.
    // Release the pending request ourselves so retry and later heartbeats work.
    deadline=setTimeout(()=>{if(stopped||current!==requestNumber)return;requestNumber++;pending=false;onError('Your location is taking too long. Allow location access and tap Update location.');},gpsTimeoutMs);
    geolocation.getCurrentPosition(async position=>{
      if(stopped||current!==requestNumber)return;
      clearTimeout(deadline);
      try{if(!stopped)await send({lat:position.coords.latitude,lng:position.coords.longitude,source:'gps'});}
      catch{if(!stopped)onError('Live location could not update. Check your connection.');}
      finally{if(current===requestNumber)pending=false;}
    },()=>{if(stopped||current!==requestNumber)return;clearTimeout(deadline);pending=false;onError('Allow location access so nearby parcel offers can reach you.');},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  };
  update();const timer=setInterval(update,intervalMs);
  const stop=()=>{stopped=true;requestNumber++;clearTimeout(deadline);clearInterval(timer);};
  stop.refresh=update;
  return stop;
}
