import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const { ObjectId } = mongoose.Types;

async function setupMarketingCmsDiwali() {
  const uri = process.env.MONGO_URI || 'mongodb+srv://bulkimart_db_user:Q5WFULIWYo3jpMyP@cluster0.q39nutg.mongodb.net/bulkimart';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;

  const admin = await db.collection('admins').findOne({});
  const adminId = admin?._id || new ObjectId('6ac935337f8251be9726e8e1');

  // Categories
  const groceryCat = await db.collection('categories').findOne({ slug: 'grocery--test-category' })
    || await db.collection('categories').findOne({ type: 'grocery', isActive: true });
  const ecomCat = await db.collection('categories').findOne({ slug: 'ecommerce--smart-buy' })
    || await db.collection('categories').findOne({ type: 'ecommerce', isActive: true });

  console.log('Target Grocery Category:', groceryCat?.name, groceryCat?._id);
  console.log('Target Ecom Category:', ecomCat?.name, ecomCat?._id);

  const now = new Date();
  const startDate = new Date('2026-10-01T00:00:00.000Z');
  const endDate = new Date('2027-01-31T23:59:59.000Z');

  // 1. Create / Update Diwali Campaign
  let campaign = await db.collection('campaigns').findOne({ name: 'Diwali Dhamaka Sale' });
  const campaignData = {
    name: 'Diwali Dhamaka Sale',
    description: 'Celebrate the Festival of Lights with flat 40% OFF on all festive essentials & sweets!',
    discountValue: 40,
    discountType: 'PERCENTAGE',
    targetType: 'CATEGORY',
    targetCategory: groceryCat._id,
    targetProducts: [],
    bannerImage: 'https://res.cloudinary.com/ccqcepfo/image/upload/v1793609736/nhcone/banners/nln47d5mzsy6ch8znzxk.jpg',
    startAt: startDate,
    endAt: endDate,
    isEnabled: true,
    isDraft: false,
    participationMode: 'ALL',
    updatedBy: adminId,
    updatedAt: now,
  };

  let campaignId;
  if (campaign) {
    campaignId = campaign._id;
    await db.collection('campaigns').updateOne({ _id: campaignId }, { $set: campaignData });
    console.log('Updated existing Diwali campaign:', campaignId);
  } else {
    campaignData.createdAt = now;
    campaignData.createdBy = adminId;
    const res = await db.collection('campaigns').insertOne(campaignData);
    campaignId = res.insertedId;
    console.log('Created new Diwali campaign:', campaignId);
  }

  // 2. Setup CampaignParticipation for active products
  const products = await db.collection('products').find({
    isActive: true,
    isDeleted: false,
    status: 'approved',
  }).toArray();

  console.log(`Setting up campaign participation for ${products.length} products...`);
  for (const prod of products) {
    const price = Number(prod.price) || 0;
    const campaignPrice = Math.max(0, Math.round(price * 0.60)); // 40% off
    await db.collection('campaignparticipations').updateOne(
      { campaignId, productId: prod._id },
      {
        $set: {
          sellerId: prod.sellerId || adminId,
          status: 'ACCEPTED',
          discountType: 'PERCENTAGE',
          discountValue: 40,
          originalPriceSnapshot: price,
          campaignPrice,
          acceptedAt: now,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );
  }
  console.log('Campaign participation updated successfully');

  // 3. Setup Three Storefront Banners (HOME_HERO)
  // Banner 1: Diwali Dhamaka Deals (CAMPAIGN) with Diya flame animation
  const banner1Data = {
    title: 'Diwali Dhamaka Sale — Flat 40% OFF',
    subtitle: 'Authentic festive sweets, dry fruits & gift packs',
    image: 'https://res.cloudinary.com/ccqcepfo/image/upload/v1793609736/nhcone/banners/nln47d5mzsy6ch8znzxk.jpg',
    cta: 'Shop Deals',
    isArchived: false,
    type: 'general',
    category: 'home',
    placement: 'HOME_HERO',
    actionType: 'CAMPAIGN',
    targetCampaign: campaignId,
    animation: {
      enabled: true,
      preset: 'diya',
      presets: ['diya'],
      colors: ['#FFD700', '#FF7A00', '#D97706', '#8B2500'],
      speed: 1,
      density: 40,
      opacity: 0.8,
      duration: 0,
      scope: 'banner',
      intensity: 'medium',
      size: 1,
      direction: 'down',
      reducedMotion: 'hide',
    },
    isActive: true,
    isDraft: false,
    priority: 100,
    startDate,
    endDate,
    updatedAt: now,
  };

  // Banner 2: Festive Sweets & Delights (CATEGORY -> groceryCat)
  const banner2Data = {
    title: 'Diwali Sweets & Festive Treats',
    subtitle: 'Traditional Indian sweets made fresh for celebrations',
    image: 'https://res.cloudinary.com/ccqcepfo/image/upload/v1793188343/nhcone/banners/x0czz1x8soxcvrvttk0t.webp',
    cta: 'Order Sweets',
    isArchived: false,
    type: 'general',
    category: 'home',
    placement: 'HOME_HERO',
    actionType: 'CATEGORY',
    targetCategory: groceryCat._id,
    isActive: true,
    isDraft: false,
    priority: 90,
    startDate,
    endDate,
    updatedAt: now,
  };

  // Banner 3: Diwali Lights & Smart Buy (CATEGORY -> ecomCat)
  const banner3Data = {
    title: 'Festive Gifts & Smart Buy Deals',
    subtitle: 'Special Diwali hampers, electronics & festival essentials',
    image: 'https://res.cloudinary.com/ccqcepfo/image/upload/v1793188624/nhcone/banners/yubguyppharppbrvxobx.webp',
    cta: 'Explore Gifts',
    isArchived: false,
    type: 'general',
    category: 'home',
    placement: 'HOME_HERO',
    actionType: 'CATEGORY',
    targetCategory: ecomCat._id,
    isActive: true,
    isDraft: false,
    priority: 80,
    startDate,
    endDate,
    updatedAt: now,
  };

  const banners = [banner1Data, banner2Data, banner3Data];
  const bannerIds = [];
  for (const b of banners) {
    let existing = await db.collection('banners').findOne({ title: b.title });
    if (existing) {
      await db.collection('banners').updateOne({ _id: existing._id }, { $set: b });
      bannerIds.push(existing._id);
      console.log('Updated banner:', b.title, existing._id);
    } else {
      b.createdAt = now;
      b.createdBy = adminId;
      const res = await db.collection('banners').insertOne(b);
      bannerIds.push(res.insertedId);
      console.log('Created banner:', b.title, res.insertedId);
    }
  }

  // Also make sure banner 6adca13d992dd8cc1b5273ef is linked to campaign
  await db.collection('banners').updateOne(
    { _id: new ObjectId('6adca13d992dd8cc1b5273ef') },
    {
      $set: {
        actionType: 'CAMPAIGN',
        targetCampaign: campaignId,
        image: '/uploads/banners/diwali_grand_sale.jpg',
        startDate,
        endDate,
        isActive: true,
      }
    }
  );

  // 4. Update Storefront Experiences (Diwali Theme & Sections)
  // 4a. Diwali Theme: Header with lights, fireworks, candles animations!
  const themeExperience = await db.collection('storefrontexperiences').findOne({ kind: 'theme', name: 'diwali' });
  if (themeExperience) {
    await db.collection('storefrontexperiences').updateOne(
      { _id: themeExperience._id },
      {
        $set: {
          status: 'published',
          startAt: startDate,
          endAt: endDate,
          'config.header': {
            enabled: true,
            title: 'Diwali Dhamaka Celebration',
            subtitle: 'Up to 40% OFF on Sweets, Dry Fruits & Festive Gifts',
            cta: 'Shop Deals',
            target: 'campaign',
            campaignId: String(campaignId),
            height: 180,
            background: '#79000B',
            text: '#FFFFFF',
            countdown: {
              enabled: true,
              title: 'Diwali Sale Ends In',
              startAt: startDate.toISOString(),
              endAt: endDate.toISOString(),
              showRemaining: true,
              expiredText: 'Sale Ended',
            },
          },
          'config.animation': {
            enabled: true,
            preset: 'lights',
            presets: ['lights', 'fireworks', 'candles'],
            colors: ['#FFD45A', '#FF8A00', '#FF4D4D'],
            speed: 1,
            density: 45,
            opacity: 0.8,
            duration: 0,
            scope: 'homepage',
            intensity: 'medium',
            size: 1,
            direction: 'down',
            reducedMotion: 'hide',
          },
          updatedAt: now,
        }
      }
    );
    console.log('Updated Diwali theme experience');
  }

  // 4b. Storefront Section 1: Diwali Dhamaka Deals (source: campaign)
  let section1 = await db.collection('storefrontexperiences').findOne({ kind: 'section', name: 'Diwali Dhamaka Deals' });
  const section1Data = {
    kind: 'section',
    name: 'Diwali Dhamaka Deals',
    description: 'Exclusive festive offers: 40% OFF on sweets & festive delights',
    status: 'published',
    scope: 'global',
    device: 'all',
    priority: 100,
    order: 1,
    startAt: startDate,
    endAt: endDate,
    timezone: 'Asia/Kolkata',
    config: {
      source: 'campaign',
      campaignId: String(campaignId),
      bannerId: bannerIds[0],
      title: 'TOP DEALS',
      description: 'Exclusive Diwali deals: flat 40% OFF on all festive favourites',
      layout: 'festive_grid',
      limit: 9,
      variant: 'festive_deals',
      festiveTrim: true,
      appearance: {
        background: '#FFF8E7',
        text: '#B91C1C',
        accent: '#F59E0B',
      },
    },
    updatedAt: now,
    updatedBy: adminId,
  };

  if (section1) {
    await db.collection('storefrontexperiences').updateOne({ _id: section1._id }, { $set: section1Data });
    console.log('Updated Diwali section 1');
  } else {
    section1Data.createdAt = now;
    section1Data.createdBy = adminId;
    await db.collection('storefrontexperiences').insertOne(section1Data);
    console.log('Created Diwali section 1');
  }

  // 4c. Storefront Section 2: Diwali Festive Treats (source: category)
  let section2 = await db.collection('storefrontexperiences').findOne({ kind: 'section', name: 'Diwali Festive Treats' });
  const section2Data = {
    kind: 'section',
    name: 'Diwali Festive Treats',
    description: 'Customer favourite sweets and essentials',
    status: 'published',
    scope: 'global',
    device: 'all',
    priority: 90,
    order: 2,
    startAt: startDate,
    endAt: endDate,
    timezone: 'Asia/Kolkata',
    config: {
      source: 'category',
      categoryId: String(groceryCat._id),
      bannerId: bannerIds[1],
      title: 'Diwali Festive Sweets & Snacks',
      description: 'Handcrafted traditional sweets and fresh treats for the festive season',
      layout: 'grid',
      limit: 6,
      variant: 'soft',
      appearance: {
        background: '#FFFFFF',
        text: '#0f172a',
        accent: '#b91c1c',
      },
    },
    updatedAt: now,
    updatedBy: adminId,
  };

  if (section2) {
    await db.collection('storefrontexperiences').updateOne({ _id: section2._id }, { $set: section2Data });
    console.log('Updated Diwali section 2');
  } else {
    section2Data.createdAt = now;
    section2Data.createdBy = adminId;
    await db.collection('storefrontexperiences').insertOne(section2Data);
    console.log('Created Diwali section 2');
  }

  console.log('All marketing and CMS content for Diwali successfully configured!');
  process.exit(0);
}

setupMarketingCmsDiwali().catch(err => {
  console.error('Error setting up marketing CMS:', err);
  process.exit(1);
});
