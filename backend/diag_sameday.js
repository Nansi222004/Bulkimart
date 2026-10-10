import { setServers } from 'dns';
if (process.env.NODE_ENV !== "production") {
  setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
}
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
console.log('DB connected');

const Product = (await import('./models/Product.js')).default;
const Seller = (await import('./models/Seller.js')).default;
const { checkSameDayEligibility, checkCartSameDayEligibility } = await import('./services/sameDay.service.js');

const products = await Product.find({ 'sameDay.enabled': true }).lean();
console.log(`Found ${products.length} products with sameDay.enabled=true`);

for (const p of products) {
  console.log('----');
  console.log('id', p._id.toString(), 'name', p.name, 'type', p.type);
  console.log('root price/stock/weight/unit:', p.price, p.stock, p.weight, p.unit);
  console.log('variants:', JSON.stringify(p.variants));
  console.log('sameDay:', JSON.stringify(p.sameDay));
  console.log('sellerId:', p.sellerId?.toString());
  console.log('isActive/isDeleted/status:', p.isActive, p.isDeleted, p.status);

  if (p.sellerId) {
    const seller = await Seller.findById(p.sellerId).lean();
    console.log('seller found:', !!seller);
    if (seller) {
      console.log('seller.status', seller.status);
      console.log('seller.sameDay', JSON.stringify(seller.sameDay));
      console.log('seller.storeDetails', JSON.stringify(seller.storeDetails));

      // Build a destination near shop if we can determine shop point
      const d = seller.storeDetails;
      let shopPt;
      if (d?.lat !== undefined && d?.lng !== undefined) shopPt = { lat: d.lat, lng: d.lng };
      else if (Array.isArray(d?.point?.coordinates)) shopPt = { lat: d.point.coordinates[1], lng: d.point.coordinates[0] };
      console.log('shopPt', shopPt);

      if (shopPt) {
        const destination = { lat: shopPt.lat + 0.01, lng: shopPt.lng + 0.01 };
        try {
          const verdict = await checkSameDayEligibility({ product: p, seller, destination, qty: 1 });
          console.log('single-line verdict:', JSON.stringify(verdict));
        } catch (err) {
          console.log('single-line verdict THREW:', err.message);
        }

        try {
          const cartVerdict = await checkCartSameDayEligibility({ lines: [{ product: p, seller, qty: 1 }], destination });
          console.log('cart verdict:', JSON.stringify(cartVerdict));
        } catch (err) {
          console.log('cart verdict THREW:', err.message);
        }
      }
    }
  }
}

await mongoose.disconnect();
console.log('done');
