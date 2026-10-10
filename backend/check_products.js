import { setServers } from 'dns';
if (process.env.NODE_ENV !== "production") {
  setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
}
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
console.log('DB connected');

const ProductM = mongoose.model('Product', new mongoose.Schema({}, { strict: false }));

const products = await ProductM.find({}).lean();
console.log(`Found ${products.length} products:`);
for (const p of products) {
  console.log(`- ID: ${p._id.toString()} | Name: ${p.name} | SellerID: ${p.sellerId?.toString()} | Price: ${p.price}`);
}

await mongoose.disconnect();
