import mongoose from 'mongoose';
import Seller from './models/Seller.js';
import NHCPlan from './models/NHCPlan.js';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/nhcone';

async function checkSellers() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');
  const sellers = await Seller.find({}).populate('userId', 'name phone email');
  console.log('Found sellers count:', sellers.length);
  const plans = await NHCPlan.find({});
  console.log('Available NHC Plans in DB:', plans.map(p => ({ id: p._id, name: p.name, amount: p.amount, type: p.planType })));

  for (const s of sellers) {
    console.log('Seller:', s._id, '| Business:', s.businessName, '| Store:', s.storeDetails?.name, '| isNscSeller:', s.isNscSeller, '| nhcPlan:', JSON.stringify(s.nhcPlan));
  }
  await mongoose.disconnect();
}

checkSellers().catch(console.error);
