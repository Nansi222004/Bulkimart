import { setServers } from 'dns';
if (process.env.NODE_ENV !== "production") {
  setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
}
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
console.log('DB connected');

const SellerM = mongoose.model('Seller', new mongoose.Schema({}, { strict: false }));

const sellers = await SellerM.find({}).lean();
console.log(`Found ${sellers.length} sellers:`);
for (const s of sellers) {
  console.log(`- ID: ${s._id.toString()} | Name: ${s.storeDetails?.name} | Status: ${s.status}`);
}

await mongoose.disconnect();
