import mongoose from 'mongoose';
import dotenv from 'dotenv';
import SellerPromotion from '../models/SellerPromotion.js';
import Seller from '../models/Seller.js';
import Product from '../models/Product.js';
import { syncPromotionBanner } from '../services/sellerPromotion.service.js';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/nhcone';

async function seedSellerPromotionBanner() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find any existing seller or create a dummy seller ID
    let seller = await Seller.findOne();
    const sellerId = seller ? seller._id : new mongoose.Types.ObjectId();

    // Find a product or use dummy
    let product = await Product.findOne();
    const productId = product ? product._id : new mongoose.Types.ObjectId();

    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

    // Check if demo seller promotion already exists
    let promotion = await SellerPromotion.findOne({ title: 'Special Seller Mega Offer' });

    // Fields matching the real SellerPromotion.js schema — a previous
    // version of this script used productId/landingType/pricing, none of
    // which are declared fields, so Mongoose's default strict mode
    // silently dropped them on save (selectedProducts ended up empty and
    // there was no package snapshot at all). Fixed to use the actual
    // fields: selectedProducts[], packageId + its snapshot columns.
    if (!promotion) {
      promotion = await SellerPromotion.create({
        sellerId,
        module: 'QUICK',
        title: 'Special Seller Mega Offer',
        description: 'Exclusive 30% Off on Fresh Local Products!',
        bannerImage: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80',
        selectedProducts: product ? [productId] : [],
        packageNameSnapshot: 'Demo 30-Day Package',
        durationDaysSnapshot: 30,
        amountSnapshot: 3000,
        placementSnapshot: 'HOME_HERO',
        status: 'ACTIVE',
        approvedAt: now,
        activatedAt: now,
        expiresAt: expires,
      });
      console.log('Created sample Seller Promotion document:', promotion._id);
    } else {
      promotion.status = 'ACTIVE';
      promotion.approvedAt = now;
      promotion.activatedAt = now;
      promotion.expiresAt = expires;
      await promotion.save();
      console.log('Updated existing Seller Promotion to ACTIVE:', promotion._id);
    }

    const linkedBanner = await syncPromotionBanner(promotion);
    console.log('Synced linked Banner document successfully:', linkedBanner._id);
    console.log('Seller Promotion Hero Banner seed complete.');
  } catch (err) {
    console.error('Error seeding Seller Promotion Banner:', err);
  } finally {
    await mongoose.disconnect();
  }
}

seedSellerPromotionBanner();
