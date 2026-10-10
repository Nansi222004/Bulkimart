import 'dotenv/config';
import { setServers } from 'dns';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import Product from '../models/Product.js';
import { uploadToCloudinary, verifyCloudinary } from '../services/cloudinary.service.js';

if (process.env.NODE_ENV === 'development') setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const ASSETS_DIR = path.resolve('d:/NHCONEroot/NHCONE-/forntend/src/assets');

// Product name to asset image mapping
const PRODUCT_IMAGE_MAP = {
  'Onion 2kg': 'product_onion_fresh.jpg',
  'Chocolate Cream Biscuits 300g': 'product_chocolate_biscuits.jpg',
  'Basmati Rice 5kg': 'product_rice.png',
  'Toor Dal 1kg': 'product_turmeric.png', // high quality pulse/grain photo
  'Full Cream Milk 1L': 'product_milk_bottle.png',
  'Cotton Formal Shirt — Sky Blue': 'product_mens_cotton_shirt.png',
  'Handwoven Cotton Saree': 'product_womens_cotton_saree.png',
  'Stainless Steel Peeler': 'product_solar_desk_fan.png',
  'Portable USB Blender 380ml': 'product_solar_charger.png',
  'LED Bulb 9W — Pack of 4': 'product_emergency_bulb.png',
  'Homemade Mango Pickle (Traditional Sun-Dried)': 'product_pickle.png',
  'Raw Forest Honey (Unprocessed)': 'product_honey.png',
  'Homemade Turmeric Masala Powder (Stone-Ground)': 'product_turmeric.png',
  'Homemade Lemon Pickle (Sun-Cured)': 'product_pickle.png',
};

const run = async () => {
  const cl = await verifyCloudinary();
  if (!cl.ok) {
    console.error(`✖ Cloudinary not available: ${cl.message}`);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone');
  console.log(`\n📦 Connected to MongoDB: ${mongoose.connection.name}`);

  // Step 1: Remove dummy test listings
  const deleteResult = await Product.deleteMany({
    $or: [
      { name: { $regex: /^testing/i } },
      { name: { $regex: /^test/i } },
      { name: { $regex: /demo item/i } }
    ]
  });
  console.log(`\n🧹 Cleaned up ${deleteResult.deletedCount} dummy/test product listings.`);

  // Step 2: Upload images & update real products
  const products = await Product.find({});
  console.log(`\n📸 Processing ${products.length} remaining catalogue products...`);

  for (const product of products) {
    const assetFilename = PRODUCT_IMAGE_MAP[product.name];
    if (!assetFilename) {
      console.log(`- Skipping ${product.name} (no image mapping specified)`);
      continue;
    }

    const filepath = path.join(ASSETS_DIR, assetFilename);
    if (!fs.existsSync(filepath)) {
      console.warn(`⚠️ Asset file missing: ${filepath}`);
      continue;
    }

    console.log(`⏳ Uploading high-res image for: "${product.name}" (${assetFilename})...`);
    const buffer = fs.readFileSync(filepath);
    const ext = path.extname(assetFilename).toLowerCase();
    const format = ext === '.jpg' || ext === '.jpeg' ? 'jpg' : 'png';

    try {
      const cloudinaryUrl = await uploadToCloudinary(
        buffer,
        `products/${product.sellerId || 'catalogue'}`,
        { resource_type: 'image', format }
      );

      product.images = [cloudinaryUrl];
      await product.save();
      console.log(`  ✅ Updated "${product.name}" -> ${cloudinaryUrl}`);
    } catch (err) {
      console.error(`  ✖ Failed to upload for "${product.name}":`, err.message);
    }
  }

  console.log(`\n✨ All products updated successfully!`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
