// Test-only second application process. It cannot use a configured DB URL.
import mongoose from 'mongoose';
if (process.env.NODE_ENV !== 'test' || process.env.PARCEL_READINESS_WORKER !== 'isolated') throw new Error('Isolated worker only');
process.on('message', async ({uri,bookingId}) => {
  try {
    const url=new URL(uri);
    if(url.protocol!=='mongodb:' || url.hostname!=='127.0.0.1' || url.pathname!=='/parcel-readiness-isolated') throw new Error('Disposable loopback database required');
    mongoose.set('autoIndex',false);mongoose.set('autoCreate',false);
    await mongoose.connect(uri);
    const {assignParcel}=await import('../services/parcelAssignment.service.js');
    const b=await assignParcel(bookingId);
    process.send({ok:true,status:b.status});
  } catch(e) { process.send({ok:false,message:e.message}); }
  finally { await mongoose.disconnect();process.disconnect(); }
});
