import mongoose from 'mongoose';

const uri = process.env.MONGO_URI || 'mongodb+srv://nhcone11_db_user:d9wn0fV7C4sTT8HR@cluster0.6xj6jfo.mongodb.net/?appName=Cluster0';

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const res = await db.collection('products').deleteMany({
    $or: [
      { name: { $regex: /Wishlist/i } },
      { images: 'a.jpg' },
      { images: 'b.jpg' }
    ]
  });

  console.log('Successfully deleted dummy wishlist products:', res.deletedCount);

  const remaining = await db.collection('products').find({}).project({ name: 1, images: 1 }).toArray();
  console.log('Remaining products count:', remaining.length);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
