import 'dotenv/config';
import { setServers } from 'dns';
import mongoose from 'mongoose';
import Category from '../models/Category.js';

if (process.env.NODE_ENV === 'development') setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone');
    console.log(`Connected to database: ${mongoose.connection.name}`);

    const systemCategories = [
      { name: "My Home", slug: "grocery--home", type: "grocery", parent: null, isSystem: true, showInNav: true },
      { name: "Smart Buy", slug: "ecommerce--smart-buy", type: "ecommerce", parent: null, isSystem: true, showInNav: true },
      { name: "Hot Deals", slug: "ecommerce--hot-deals", type: "ecommerce", parent: null, isSystem: true, showInNav: true }
    ];

    for (const cat of systemCategories) {
      const exists = await Category.findOne({ slug: cat.slug });
      if (!exists) {
        await Category.create(cat);
        console.log(`System category "${cat.name}" seeded successfully! 🚀`);
      } else {
        // Ensure isSystem and showInNav are true even if it already exists
        exists.isSystem = true;
        exists.showInNav = true;
        await exists.save();
        console.log(`System category "${cat.name}" updated to system status.`);
      }
    }

    console.log("Seeding complete!");
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error(`Error during seeding: ${err.message}`);
    process.exit(1);
  }
};

run();
