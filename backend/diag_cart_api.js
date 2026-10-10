import { setServers } from 'dns';
if (process.env.NODE_ENV !== "production") setServers(["8.8.8.8","8.8.4.4","1.1.1.1"]);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
await mongoose.connect(process.env.MONGO_URI);
console.log('connected');

const Cart = (await import('./models/Cart.js')).default;
const carts = await Cart.find({}).lean();
console.log('carts count', carts.length);
for (const c of carts) {
  console.log(c._id.toString(), c.userId?.toString(), c.channel, c.items?.length, JSON.stringify(c.items?.map(i=>({p:i.productId?.toString(), qty:i.qty, mode:i.deliveryMode}))));
}
await mongoose.disconnect();
