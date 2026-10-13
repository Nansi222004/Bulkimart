import mongoose from "mongoose";
import Admin from "../models/Admin.js";
import Category from "../models/Category.js";

/**
 * A MongoDB collection can carry only ONE text index. `Product.js` now
 * defines `product_search_text_v2` (adds `sellerName` so shop-name search
 * works) to replace the original, unnamed `{name,description,tags}` text
 * index — but Mongoose's normal `autoIndex` only ever CREATES indexes, it
 * never drops a conflicting one, so on an existing database the old index
 * would sit there forever and silently block the new one from ever being
 * created (Mongo rejects a second text index outright).
 *
 * One-time, idempotent: finds any text index on `products` that isn't the
 * current one and drops it. A fresh database has no old index to find, so
 * this is a no-op there — safe to leave in permanently rather than treating
 * it as a migration script to run once and delete.
 */
const dropStaleProductTextIndex = async () => {
  try {
    const collection = mongoose.connection.collection('products');
    const indexes = await collection.indexes();
    const stale = indexes.find((ix) => ix.textIndexVersion !== undefined && ix.name !== 'product_search_text_v2');
    if (stale) {
      await collection.dropIndex(stale.name);
      console.log(`Dropped stale product text index "${stale.name}" — Mongoose will recreate the current one.`);
    }
  } catch (err) {
    // Collection may not exist yet on a brand-new database — never fatal.
    console.warn('[DB] product text index check skipped:', err.message);
  }
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/nhcone");
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    await dropStaleProductTextIndex();

    // Seed the Super Admin ONCE. Never overwrite an existing admin's password —
    // doing so silently reverts any password changed through the admin panel on every restart.
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (adminEmail && adminPassword) {
      const existing = await Admin.findOne({ email: adminEmail });
      if (!existing) {
        await Admin.create({
          name: "Super Admin",
          email: adminEmail,
          password: adminPassword, // hashed by the pre-save hook
          role: "superAdmin",
          isActive: true,
        });
        console.log("Super Admin account seeded successfully! 🚀");
      } else if (!existing.isActive) {
        existing.isActive = true;
        await existing.save();
        console.log("Super Admin account reactivated! 🚀");
      }
    }

    // Seed System Categories
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
      }
    }
  } catch (error) {
    console.error(`Database Connection Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
