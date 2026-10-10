import mongoose from 'mongoose';
import SellerPromotion from '../models/SellerPromotion.js';
import Banner from '../models/Banner.js';

const MONGO_URI = 'mongodb+srv://nhcone11_db_user:d9wn0fV7C4sTT8HR@cluster0.6xj6jfo.mongodb.net/test?retryWrites=true&w=majority';

async function inspectAtlas() {
  console.log('Connecting to Atlas Cloud MongoDB...');
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected!');

    const promotions = await SellerPromotion.find().lean();
    console.log(`\nFound ${promotions.length} Seller Promotions in Atlas DB:`);
    for (const p of promotions) {
      console.log(JSON.stringify(p, null, 2));
    }

    const banners = await Banner.find().lean();
    console.log(`\nFound ${banners.length} Banners in Atlas DB:`);
    for (const b of banners) {
      console.log(JSON.stringify(b, null, 2));
    }

  } catch (err) {
    console.error('Atlas Inspection Error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

inspectAtlas();
