import { CHANNEL, APPROVAL } from '../../constants/enums.js';
import { ID, img } from '../ids.js';

/**
 * 60 products: 30 ecommerce / 20 grocery / 10 SHG.
 * Includes 3 featured, 3 sponsored, 5 low-stock, 4 pending, 2 rejected
 * so every admin/seller UI state has real data behind it.
 */

let n = 0;
const make = ({
  name, type, category, price, mrp, stock, unit = 'piece',
  sellerId, shgStoreId, weight, tags = [],
  status = APPROVAL.APPROVED, isActive = true,
  isFeatured = false, isSponsored = false, sponsoredRank = 0,
  rejectionReason, rating,
}) => {
  n += 1;
  return {
    _id: ID.product(n),
    type,
    sellerId,
    shgStoreId,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
    description: `${name}. Sourced and quality-checked before dispatch.`,
    images: [img(name), img(`${name} 2`)],
    category,
    price,
    mrp: mrp ?? price,
    discountPercent: mrp ? Math.round(((mrp - price) / mrp) * 100) : 0,
    stock,
    unit,
    weight,
    tags,
    status,
    isActive: status === APPROVAL.APPROVED ? isActive : false,
    isDeleted: false,
    isFeatured,
    isSponsored,
    sponsoredRank,
    rejectionReason,
    ratings: rating
      ? { average: rating, count: Math.floor(Math.random() * 40) + 5, reviews: [] }
      : { average: 0, count: 0, reviews: [] },
  };
};

const S1 = ID.seller(1); // Joshi General Store (approved)
const S2 = ID.seller(2); // Meena Traders (approved)
const G1 = ID.shg(1);    // Jai Bhavani (approved)
const G2 = ID.shg(2);    // Savitri Handloom (approved)

export const products = [
  // ============================================================ ECOMMERCE (30)
  make({ name: 'Cotton Formal Shirt', type: CHANNEL.ECOM, category: ID.cat(101), sellerId: S1, price: 799, mrp: 1299, stock: 45, weight: 300, tags: ['shirt', 'formal', 'cotton'], isFeatured: true, rating: 4.3 }),
  make({ name: 'Mens Denim Jeans', type: CHANNEL.ECOM, category: ID.cat(101), sellerId: S1, price: 1199, mrp: 1899, stock: 30, weight: 600, tags: ['jeans', 'denim'], rating: 4.1 }),
  make({ name: 'Womens Kurti Set', type: CHANNEL.ECOM, category: ID.cat(102), sellerId: S2, price: 949, mrp: 1599, stock: 22, weight: 400, tags: ['kurti', 'ethnic'], isSponsored: true, sponsoredRank: 1, rating: 4.6 }),
  make({ name: 'Womens Cotton Saree', type: CHANNEL.ECOM, category: ID.cat(102), sellerId: S2, price: 1450, mrp: 2200, stock: 18, weight: 550, tags: ['saree'], rating: 4.4 }),
  make({ name: 'Kids Cartoon T-Shirt', type: CHANNEL.ECOM, category: ID.cat(103), sellerId: S1, price: 349, mrp: 599, stock: 60, weight: 180, tags: ['kids'], rating: 4.0 }),
  make({ name: 'Kids Winter Jacket', type: CHANNEL.ECOM, category: ID.cat(103), sellerId: S1, price: 899, mrp: 1499, stock: 12, weight: 700, tags: ['kids', 'winter'] }),
  make({ name: 'Floor Cleaner 1L', type: CHANNEL.ECOM, category: ID.cat(104), sellerId: S2, price: 189, mrp: 250, stock: 120, unit: 'litre', weight: 1000, tags: ['cleaning'] }),
  make({ name: 'Dishwash Gel 750ml', type: CHANNEL.ECOM, category: ID.cat(104), sellerId: S2, price: 145, mrp: 199, stock: 95, unit: 'ml', weight: 780 }),
  make({ name: 'Microfibre Cleaning Cloth Pack', type: CHANNEL.ECOM, category: ID.cat(104), sellerId: S1, price: 249, mrp: 399, stock: 8, unit: 'pack', weight: 200 }),
  make({ name: 'Plastic Storage Container Set', type: CHANNEL.ECOM, category: ID.cat(105), sellerId: S1, price: 649, mrp: 999, stock: 40, unit: 'pack', weight: 900 }),
  make({ name: 'Foldable Wardrobe Organiser', type: CHANNEL.ECOM, category: ID.cat(105), sellerId: S2, price: 1299, mrp: 1999, stock: 15, weight: 2200 }),
  make({ name: 'Handcrafted Wooden Elephant', type: CHANNEL.ECOM, category: ID.cat(106), sellerId: S1, price: 899, mrp: 1400, stock: 25, weight: 800, tags: ['handicraft', 'wooden'], isFeatured: true, rating: 4.8 }),
  make({ name: 'Wooden Serving Tray', type: CHANNEL.ECOM, category: ID.cat(106), sellerId: S1, price: 549, mrp: 850, stock: 33, weight: 650 }),
  make({ name: 'Bamboo Table Lamp', type: CHANNEL.ECOM, category: ID.cat(107), sellerId: S2, price: 1150, mrp: 1750, stock: 14, weight: 1100, tags: ['bamboo', 'eco'] }),
  make({ name: 'Bamboo Storage Basket', type: CHANNEL.ECOM, category: ID.cat(107), sellerId: S2, price: 425, mrp: 699, stock: 48, weight: 500 }),
  make({ name: 'USB-C Fast Charging Cable', type: CHANNEL.ECOM, category: ID.cat(108), sellerId: S1, price: 299, mrp: 599, stock: 200, weight: 90, tags: ['mobile'] }),
  make({ name: 'Bluetooth Earbuds', type: CHANNEL.ECOM, category: ID.cat(108), sellerId: S1, price: 1499, mrp: 2999, stock: 55, weight: 150, isSponsored: true, sponsoredRank: 2, rating: 4.2 }),
  make({ name: 'Mobile Tempered Glass', type: CHANNEL.ECOM, category: ID.cat(108), sellerId: S2, price: 149, mrp: 349, stock: 300, weight: 40 }),
  make({ name: 'Electric Hand Blender', type: CHANNEL.ECOM, category: ID.cat(109), sellerId: S2, price: 1899, mrp: 2799, stock: 20, weight: 1300 }),
  make({ name: 'Electric Kettle 1.5L', type: CHANNEL.ECOM, category: ID.cat(109), sellerId: S2, price: 1249, mrp: 1899, stock: 5, weight: 1100 }),
  make({ name: 'Non-Stick Tawa', type: CHANNEL.ECOM, category: ID.cat(110), sellerId: S1, price: 749, mrp: 1199, stock: 38, weight: 900 }),
  make({ name: 'Stainless Steel Pressure Cooker 3L', type: CHANNEL.ECOM, category: ID.cat(110), sellerId: S1, price: 1899, mrp: 2899, stock: 17, weight: 2400, rating: 4.5 }),
  make({ name: 'Mens Casual Sneakers', type: CHANNEL.ECOM, category: ID.cat(5), sellerId: S2, price: 1399, mrp: 2299, stock: 26, weight: 800 }),
  make({ name: 'Womens Ethnic Juttis', type: CHANNEL.ECOM, category: ID.cat(5), sellerId: S2, price: 799, mrp: 1299, stock: 19, weight: 450 }),
  make({ name: 'Herbal Face Wash 100ml', type: CHANNEL.ECOM, category: ID.cat(7), sellerId: S1, price: 249, mrp: 399, stock: 88, unit: 'ml', weight: 120 }),
  make({ name: 'Ayurvedic Hair Oil 200ml', type: CHANNEL.ECOM, category: ID.cat(7), sellerId: S1, price: 329, mrp: 499, stock: 64, unit: 'ml', weight: 230 }),
  make({ name: 'Spiral Notebook Pack of 5', type: CHANNEL.ECOM, category: ID.cat(8), sellerId: S2, price: 349, mrp: 500, stock: 150, unit: 'pack', weight: 900 }),
  // ---- non-happy states
  make({ name: 'Smart LED Bulb', type: CHANNEL.ECOM, category: ID.cat(109), sellerId: S1, price: 649, mrp: 999, stock: 40, weight: 150, status: APPROVAL.PENDING }),
  make({ name: 'Wireless Keyboard', type: CHANNEL.ECOM, category: ID.cat(108), sellerId: S2, price: 1299, mrp: 1999, stock: 25, weight: 700, status: APPROVAL.PENDING }),
  make({ name: 'Imitation Branded Perfume', type: CHANNEL.ECOM, category: ID.cat(7), sellerId: S2, price: 499, mrp: 1999, stock: 30, weight: 200, status: APPROVAL.REJECTED, rejectionReason: 'Counterfeit branding — violates marketplace policy.' }),

  // ============================================================== GROCERY (20)
  make({ name: 'Basmati Rice 5kg', type: CHANNEL.GROCERY, category: ID.cat(201), sellerId: S1, price: 549, mrp: 699, stock: 80, unit: 'kg', weight: 5000, tags: ['rice', 'staple'], isFeatured: true, rating: 4.5 }),
  make({ name: 'Sona Masoori Rice 10kg', type: CHANNEL.GROCERY, category: ID.cat(201), sellerId: S1, price: 720, mrp: 899, stock: 45, unit: 'kg', weight: 10000 }),
  make({ name: 'Whole Wheat Atta 10kg', type: CHANNEL.GROCERY, category: ID.cat(202), sellerId: S1, price: 445, mrp: 550, stock: 70, unit: 'kg', weight: 10000, tags: ['atta'], isSponsored: true, sponsoredRank: 3 }),
  make({ name: 'Multigrain Atta 5kg', type: CHANNEL.GROCERY, category: ID.cat(202), sellerId: S2, price: 329, mrp: 420, stock: 52, unit: 'kg', weight: 5000 }),
  make({ name: 'Toor Dal 1kg', type: CHANNEL.GROCERY, category: ID.cat(203), sellerId: S1, price: 165, mrp: 199, stock: 110, unit: 'kg', weight: 1000, tags: ['dal'] }),
  make({ name: 'Moong Dal 1kg', type: CHANNEL.GROCERY, category: ID.cat(203), sellerId: S1, price: 148, mrp: 180, stock: 95, unit: 'kg', weight: 1000 }),
  make({ name: 'Chana Dal 1kg', type: CHANNEL.GROCERY, category: ID.cat(203), sellerId: S2, price: 92, mrp: 115, stock: 7, unit: 'kg', weight: 1000 }),
  make({ name: 'Kachi Ghani Mustard Oil 1L', type: CHANNEL.GROCERY, category: ID.cat(204), sellerId: S1, price: 178, mrp: 220, stock: 130, unit: 'litre', weight: 1000, tags: ['oil'] }),
  make({ name: 'Refined Sunflower Oil 5L', type: CHANNEL.GROCERY, category: ID.cat(205), sellerId: S1, price: 820, mrp: 950, stock: 60, unit: 'litre', weight: 5000 }),
  make({ name: 'Pure Cow Ghee 1L', type: CHANNEL.GROCERY, category: ID.cat(10), sellerId: S2, price: 649, mrp: 799, stock: 40, unit: 'litre', weight: 1000, rating: 4.7 }),
  make({ name: 'Jeera Whole 200g', type: CHANNEL.GROCERY, category: ID.cat(206), sellerId: S1, price: 98, mrp: 130, stock: 85, unit: 'g', weight: 200 }),
  make({ name: 'Black Pepper Whole 100g', type: CHANNEL.GROCERY, category: ID.cat(206), sellerId: S1, price: 145, mrp: 185, stock: 55, unit: 'g', weight: 100 }),
  make({ name: 'Haldi Powder 500g', type: CHANNEL.GROCERY, category: ID.cat(207), sellerId: S2, price: 112, mrp: 145, stock: 90, unit: 'g', weight: 500 }),
  make({ name: 'Garam Masala 100g', type: CHANNEL.GROCERY, category: ID.cat(207), sellerId: S2, price: 89, mrp: 110, stock: 6, unit: 'g', weight: 100 }),
  make({ name: 'Full Cream Milk 1L', type: CHANNEL.GROCERY, category: ID.cat(208), sellerId: S1, price: 68, mrp: 72, stock: 200, unit: 'litre', weight: 1000 }),
  make({ name: 'Fresh Paneer 200g', type: CHANNEL.GROCERY, category: ID.cat(208), sellerId: S1, price: 95, mrp: 110, stock: 35, unit: 'g', weight: 200 }),
  make({ name: 'Whole Wheat Bread', type: CHANNEL.GROCERY, category: ID.cat(209), sellerId: S2, price: 45, mrp: 55, stock: 75, unit: 'piece', weight: 400 }),
  make({ name: 'Fresh Tomato 1kg', type: CHANNEL.GROCERY, category: ID.cat(210), sellerId: S1, price: 38, mrp: 50, stock: 150, unit: 'kg', weight: 1000 }),
  make({ name: 'Fresh Onion 2kg', type: CHANNEL.GROCERY, category: ID.cat(210), sellerId: S1, price: 74, mrp: 90, stock: 140, unit: 'kg', weight: 2000 }),
  make({ name: 'Assam Tea Leaves 500g', type: CHANNEL.GROCERY, category: ID.cat(15), sellerId: S2, price: 245, mrp: 320, stock: 68, unit: 'g', weight: 500, status: APPROVAL.PENDING }),

  // ================================================================== SHG (10)
  make({ name: 'Homemade Mango Pickle 500g', type: CHANNEL.SHG, category: ID.cat(301), shgStoreId: G1, price: 220, mrp: 280, stock: 40, unit: 'g', weight: 500, tags: ['pickle', 'homemade'], isFeatured: true, rating: 4.9 }),
  make({ name: 'Homemade Lemon Pickle 500g', type: CHANNEL.SHG, category: ID.cat(302), shgStoreId: G1, price: 195, mrp: 250, stock: 35, unit: 'g', weight: 500, rating: 4.6 }),
  make({ name: 'Mixed Vegetable Pickle 400g', type: CHANNEL.SHG, category: ID.cat(19), shgStoreId: G1, price: 210, mrp: 260, stock: 28, unit: 'g', weight: 400 }),
  make({ name: 'Handmade Urad Papad 200g', type: CHANNEL.SHG, category: ID.cat(303), shgStoreId: G1, price: 85, mrp: 110, stock: 120, unit: 'g', weight: 200 }),
  make({ name: 'Forest Honey 500g', type: CHANNEL.SHG, category: ID.cat(306), shgStoreId: G1, price: 445, mrp: 599, stock: 22, unit: 'g', weight: 500, tags: ['organic'], rating: 4.8 }),
  make({ name: 'Organic Jaggery Blocks 1kg', type: CHANNEL.SHG, category: ID.cat(22), shgStoreId: G1, price: 130, mrp: 170, stock: 9, unit: 'kg', weight: 1000 }),
  make({ name: 'Handloom Cotton Saree', type: CHANNEL.SHG, category: ID.cat(304), shgStoreId: G2, price: 1850, mrp: 2600, stock: 12, weight: 600, tags: ['handloom'], rating: 4.7 }),
  make({ name: 'Handwoven Cotton Dupatta', type: CHANNEL.SHG, category: ID.cat(305), shgStoreId: G2, price: 650, mrp: 950, stock: 24, weight: 250 }),
  make({ name: 'Jute Shopping Bag', type: CHANNEL.SHG, category: ID.cat(24), shgStoreId: G2, price: 275, mrp: 400, stock: 55, weight: 300, tags: ['eco', 'jute'] }),
  make({ name: 'Handmade Herbal Soap Pack of 3', type: CHANNEL.SHG, category: ID.cat(23), shgStoreId: G2, price: 320, mrp: 450, stock: 30, unit: 'pack', weight: 350, status: APPROVAL.REJECTED, rejectionReason: 'Missing ingredient list on the product label.' }),
];
