import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const bannerSchema = new mongoose.Schema({
  title: String,
  type: String,
  category: String,
  startDate: Date,
  endDate: Date,
  isActive: Boolean,
  isDraft: Boolean,
  actionType: String,
}, { strict: false });

const Banner = mongoose.model('Banner', bannerSchema);

async function check() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nhcone';
  await mongoose.connect(uri);
  const banners = await Banner.find({}).lean();
  console.log("TOTAL BANNERS IN DB:", banners.length);
  banners.forEach(b => {
    console.log({
      id: b._id,
      title: b.title,
      type: b.type,
      category: b.category,
      startDate: b.startDate,
      endDate: b.endDate,
      isActive: b.isActive,
      isDraft: b.isDraft,
      actionType: b.actionType
    });
  });
  await mongoose.disconnect();
}

check().catch(console.error);
