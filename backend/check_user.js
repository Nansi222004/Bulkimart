import { setServers } from 'dns';
if (process.env.NODE_ENV !== "production") {
  setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
}
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
console.log('DB connected');

const UserM = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
const SellerM = mongoose.model('Seller', new mongoose.Schema({}, { strict: false }));

const users = await UserM.find({ name: /mankar/i }).lean();
console.log(`Found ${users.length} users:`);
for (const u of users) {
  console.log(`- User ID: ${u._id.toString()} | Name: ${u.name} | Phone: ${u.phone}`);
  const s = await SellerM.findOne({ userId: u._id }).lean();
  if (s) {
    console.log(`  -> Seller ID: ${s._id.toString()} | Status: ${s.status} | Store: ${s.storeDetails?.name}`);
  } else {
    console.log(`  -> No seller profile found`);
  }
}

await mongoose.disconnect();
