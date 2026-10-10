import { setServers } from 'dns';
if (process.env.NODE_ENV !== "production") setServers(["8.8.8.8","8.8.4.4","1.1.1.1"]);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
await mongoose.connect(process.env.MONGO_URI);
await import('./models/Category.js');
await import('./models/Seller.js');

const Cart = (await import('./models/Cart.js')).default;
const Product = (await import('./models/Product.js')).default;

const cart = await Cart.findOne({ userId: '6a8487d14019d3b2da3ba045', channel: 'ecommerce' });
console.log('cart items length', cart.items.length);
console.log('raw', JSON.stringify(cart.items));
console.log('cart.toObject', JSON.stringify(cart.toObject().items));

const leanCart = await Cart.findOne({ userId: '6a8487d14019d3b2da3ba045', channel: 'ecommerce' }).lean();
console.log('lean items', JSON.stringify(leanCart.items));

await mongoose.disconnect();
