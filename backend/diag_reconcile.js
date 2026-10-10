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
console.log('cart', cart?._id?.toString(), cart?.items);

const products = await Product.find({ _id: { $in: cart.items.map(i=>i.productId) } }).populate('category','name').lean();
console.log('products found', products.length);
for (const p of products) {
  console.log(p._id.toString(), 'isDeleted', p.isDeleted, 'isActive', p.isActive, 'status', p.status, 'stock', p.stock, 'price', p.price);
}

await mongoose.disconnect();
