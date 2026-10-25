// Read-only diagnostics. Never print credentials, addresses, phones or proof codes.
import '../config/bootstrap.js';
import mongoose from 'mongoose';
const deadline=setTimeout(()=>{console.error('Read-only parcel inspection: connection timed out');process.exit(1);},20000);
try {
  await mongoose.connect(process.env.MONGO_URI,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:8000,connectTimeoutMS:8000});
  const db=mongoose.connection.db;
  const users=await db.collection('users').find({name:/ritik.*tiwari/i},{projection:{name:1,isActive:1,roles:1}}).limit(5).toArray();
  const riders=[];
  for(const u of users){
    const p=await db.collection('deliverypartners').findOne({userId:u._id},{projection:{status:1,zones:1,isAvailable:1,currentLocation:1,deliveryRadiusKm:1,parcelReservation:1,parcelReturnClaim:1}});
    riders.push({name:u.name,active:u.isActive,deliveryRole:u.roles?.includes('delivery'),partner:p,openShopping:p?await db.collection('orders').countDocuments({deliveryPartnerId:p._id,status:{$nin:['delivered','cancelled','returned','refunded']}}):null});
  }
  const id=process.argv[2];
  const filter=id&&mongoose.isValidObjectId(id)?{_id:new mongoose.Types.ObjectId(id)}:{};
  const parcels=await db.collection('parceldeliveries').find(filter,{projection:{reference:1,status:1,paymentStatus:1,paymentMethod:1,partnerId:1,'assignment.reason':1,'assignment.offer.partnerIds':1,'assignment.offer.partnerId':1,'assignment.offer.expiresAt':1,'assignment.attempts.partnerId':1,'assignment.attempts.outcome':1,'details.pickup.lat':1,'details.pickup.lng':1,'details.pickup.pincode':1,'details.dropoff.pincode':1,'pricing.policy.assignmentRadiusKm':1,'pricing.policy.locationMaxAgeSeconds':1,createdAt:1}}).sort({createdAt:-1}).limit(3).toArray();
  const {eligibleParcelRider}=await import('../services/parcelAssignment.service.js');
  const {distanceKm}=await import('../utils/geo.js');
  const {default:Partner}=await import('../models/DeliveryPartner.js');
  const {default:Parcel}=await import('../models/ParcelDelivery.js');
  const checks=[];
  for(const rider of riders) for(const parcel of parcels){
    const partner=rider.partner&&await Partner.findById(rider.partner._id),booking=await Parcel.findById(parcel._id);
    checks.push({rider:rider.name,booking:parcel.reference,locationAgeSeconds:partner?.currentLocation?.updatedAt?Math.round((Date.now()-new Date(partner.currentLocation.updatedAt))/1000):null,pickupDistanceKm:partner?distanceKm(partner.currentLocation,booking.details.pickup):null,eligible:partner?await eligibleParcelRider(partner,booking,null):false});
  }
  console.log(JSON.stringify({readOnly:true,checkedAt:new Date().toISOString(),riders,parcels,checks},null,2));
}catch(error){console.error(JSON.stringify({readOnly:true,errorType:error.name,code:error.code}));process.exitCode=1;}
finally{clearTimeout(deadline);await mongoose.disconnect();}
