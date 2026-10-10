import { setServers } from 'dns';
if (process.env.NODE_ENV !== "production") setServers(["8.8.8.8","8.8.4.4","1.1.1.1"]);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
await mongoose.connect(process.env.MONGO_URI);
console.log('connected');
await import('./models/Category.js');
await import('./models/Seller.js');
await import('./models/Product.js');

const { getCart } = await import('./controllers/cart.controller.js');
const User = (await import('./models/User.js')).default;

const user = await User.findById('6a8487d14019d3b2da3ba045').lean();
console.log('user found', !!user, user?.isCDSVerified);

const req = {
  user,
  query: { channel: 'ecommerce', lat: '22.72', lng: '75.88', deliveryMode: 'same_day' },
};

await new Promise((resolve) => {
  const res = {
    status(c) { this.statusCode = c; return this; },
    json(b) { console.log('RESPONSE', this.statusCode, JSON.stringify(b, null, 2)); resolve(); return this; },
  };
  getCart(req, res, (err) => { console.log('NEXT called with error:', err); resolve(); });
});

await mongoose.disconnect();
