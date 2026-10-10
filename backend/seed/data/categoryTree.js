import { CHANNEL } from '../../constants/enums.js';

/**
 * Canonical 3-level category tree — Level 1 (header) → Level 2 (main) → Level 3 (sub).
 *
 * Mirrors the structure the Admin panel manages (Header / Main / Sub categories)
 * and the sections shown in the customer app, so both read from one source.
 *
 * Shape:  { name, children: [{ name, children: [{ name }] }] }
 * Slugs are derived from the full path at seed time, because the same leaf name
 * can legitimately appear under two different parents.
 */

export const categoryTree = [
  // ==========================================================================
  // E-COMMERCE
  // ==========================================================================
  {
    channel: CHANNEL.ECOM,
    name: 'Automotive',
    children: [
      { name: 'Car Accessories', children: [{ name: 'Seat Covers' }, { name: 'Car Chargers' }, { name: 'GPS Trackers' }] },
      { name: 'Car Care', children: [{ name: 'Car Wax' }, { name: 'Shampoo' }, { name: 'Microfiber Towels' }] },
      { name: 'Motorcycle Parts', children: [{ name: 'Helmets' }, { name: 'Brake Pads' }, { name: 'Riding Gloves' }] },
    ],
  },
  {
    channel: CHANNEL.ECOM,
    name: 'Baby Care',
    children: [
      { name: 'Baby Food', children: [{ name: 'Infant Formula' }, { name: 'Baby Cereals' }, { name: 'Purees & Powders' }] },
      { name: 'Diapers', children: [{ name: 'Disposable Diapers' }, { name: 'Cloth Diapers' }, { name: 'Wet Wipes' }] },
      { name: 'Baby Toys', children: [{ name: 'Teethers' }, { name: 'Rattles' }, { name: 'Soft Books' }] },
    ],
  },
  {
    channel: CHANNEL.ECOM,
    name: 'Bakery',
    children: [
      { name: 'Cakes', children: [{ name: 'Chocolate Cake' }, { name: 'Vanilla Cake' }, { name: 'Red Velvet Cake' }] },
      { name: 'Breads', children: [{ name: 'Whole Wheat Bread' }, { name: 'White Bread' }, { name: 'Multigrain Bread' }] },
      { name: 'Pastries', children: [{ name: 'Croissants' }, { name: 'Macarons' }, { name: 'Puffs' }] },
    ],
  },
  {
    channel: CHANNEL.ECOM,
    name: 'Kitchen & Dining',
    children: [
      { name: 'Kitchenware & Storage', children: [{ name: 'Containers' }, { name: 'Spice Racks' }, { name: 'Tiffin Boxes' }] },
      { name: 'Kitchenware & Accessories', children: [{ name: 'Kitchen Utility & Storage' }, { name: 'Chopping Boards' }, { name: 'Kitchen Racks' }] },
    ],
  },
  {
    channel: CHANNEL.ECOM,
    name: 'Home & Kitchen',
    children: [
      { name: 'Household & Utilities', children: [{ name: 'Bulbs' }, { name: 'Extension Cords' }, { name: 'Door Mats' }] },
      { name: 'Cleaning & Maintenance', children: [{ name: 'Brooms' }, { name: 'Mops' }, { name: 'Detergent Sprays' }] },
      { name: 'Garden & Kitchen', children: [{ name: 'Seed Kits & Gardening' }, { name: 'Planters' }, { name: 'Garden Tools' }] },
    ],
  },
  {
    channel: CHANNEL.ECOM,
    name: 'Cleaning',
    children: [
      { name: 'Household Cleaning', children: [{ name: 'Brush' }, { name: 'Scrubbers' }, { name: 'Wipers' }] },
    ],
  },
  {
    channel: CHANNEL.ECOM,
    name: 'Kitchen',
    children: [
      { name: 'Kitchen Tools', children: [{ name: 'Tongs & Clamps' }, { name: 'Peeler' }, { name: 'Oil Pump' }] },
      { name: 'Serving Tools', children: [{ name: 'Serving Spoons' }, { name: 'Ladles' }, { name: 'Trays' }] },
    ],
  },
  {
    channel: CHANNEL.ECOM,
    name: 'Dining',
    children: [
      { name: 'Table Accessories', children: [{ name: 'Table Mats' }, { name: 'Napkin Holders' }, { name: 'Coasters' }] },
    ],
  },
  {
    channel: CHANNEL.ECOM,
    name: 'Appliances',
    children: [
      { name: 'Electric Juicers', children: [{ name: 'Cold Press Juicers' }, { name: 'Centrifugal Juicers' }] },
      { name: 'Portable Blenders', children: [{ name: 'USB Blenders' }, { name: 'Rechargeable Blenders' }] },
    ],
  },
  {
    channel: CHANNEL.ECOM,
    name: 'Clothing & Handlooms',
    children: [
      { name: 'Womens Wear', children: [{ name: 'Cotton Sarees' }, { name: 'Ethnic Kurtas' }, { name: 'Handwoven Shawls' }] },
      { name: 'Mens Wear', children: [{ name: 'Shirts' }, { name: 'Kurtas' }, { name: 'Trousers' }] },
      { name: 'Kids Wear', children: [{ name: 'Frocks' }, { name: 'T-Shirts' }, { name: 'Rompers' }] },
    ],
  },
  {
    channel: CHANNEL.ECOM,
    name: 'Solar & Utilities',
    children: [
      { name: 'Solar Products', children: [{ name: 'Solar Lanterns' }, { name: 'Solar Panels' }, { name: 'Solar Chargers' }] },
      { name: 'Lighting', children: [{ name: 'LED Bulbs' }, { name: 'Tube Lights' }, { name: 'Emergency Lights' }] },
    ],
  },

  // ==========================================================================
  // QUICK COMMERCE  (channel: grocery — shown in the admin as "Quick")
  //
  // Level 1 + Level 2 mirror JioMart's grocery taxonomy. JioMart itself stops at
  // two levels, so Level 3 is our own breakdown of each Level 2 into the buying
  // groups a quick-commerce shopper actually filters by.
  // ==========================================================================
  {
    channel: CHANNEL.GROCERY,
    name: 'Fruits & Vegetables',
    children: [
      { name: 'Fresh Fruits', children: [{ name: 'Seasonal Fruits' }, { name: 'Cut & Peeled Fruits' }, { name: 'Bananas & Papaya' }] },
      { name: 'Fresh Vegetables', children: [{ name: 'Leafy Vegetables' }, { name: 'Root Vegetables' }, { name: 'Gourds & Beans' }, { name: 'Onion, Potato & Tomato' }] },
      { name: 'Herbs & Seasonings', children: [{ name: 'Fresh Herbs' }, { name: 'Lemon & Chilli' }, { name: 'Sprouts' }] },
      { name: 'Exotic Fruits & Vegetables', children: [{ name: 'Berries' }, { name: 'Exotic Greens' }, { name: 'Imported Produce' }] },
    ],
  },
  {
    channel: CHANNEL.GROCERY,
    name: 'Dairy & Bakery',
    children: [
      { name: 'Dairy', children: [{ name: 'Milk' }, { name: 'Curd & Yogurt' }, { name: 'Paneer & Tofu' }, { name: 'Butter & Cheese' }] },
      { name: 'Breads & Buns', children: [{ name: 'Sandwich Bread' }, { name: 'Brown & Multigrain Bread' }, { name: 'Buns & Pav' }] },
      { name: 'Toast & Khari', children: [{ name: 'Toast' }, { name: 'Khari' }, { name: 'Rusk' }] },
      { name: 'Cakes & Cookies', children: [{ name: 'Muffins & Cupcakes' }, { name: 'Tea Cakes' }, { name: 'Cookies' }] },
    ],
  },
  {
    channel: CHANNEL.GROCERY,
    name: 'Staples',
    children: [
      { name: 'Atta, Flours & Sooji', children: [{ name: 'Whole Wheat Atta' }, { name: 'Multigrain Atta' }, { name: 'Besan & Sooji' }] },
      { name: 'Dals & Pulses', children: [{ name: 'Toor & Arhar Dal' }, { name: 'Moong & Urad Dal' }, { name: 'Chana & Rajma' }] },
      { name: 'Rice & Rice Products', children: [{ name: 'Basmati Rice' }, { name: 'Sona Masoori & Idli Rice' }, { name: 'Poha & Rice Flour' }] },
      { name: 'Edible Oils', children: [{ name: 'Mustard Oil' }, { name: 'Refined & Sunflower Oil' }, { name: 'Ghee & Vanaspati' }] },
      { name: 'Masalas & Spices', children: [{ name: 'Whole Spices' }, { name: 'Ground Spices' }, { name: 'Blended Masala' }] },
      { name: 'Salt, Sugar & Jaggery', children: [{ name: 'Salt' }, { name: 'Sugar' }, { name: 'Jaggery & Gur' }] },
      { name: 'Dry Fruits', children: [{ name: 'Almonds & Cashews' }, { name: 'Raisins & Dates' }, { name: 'Seeds & Berries' }] },
      { name: 'Soya, Wheat & Other Grains', children: [{ name: 'Soya Chunks' }, { name: 'Millets' }, { name: 'Daliya & Broken Wheat' }] },
    ],
  },
  {
    channel: CHANNEL.GROCERY,
    name: 'Snacks & Branded Foods',
    children: [
      { name: 'Biscuits & Cookies', children: [{ name: 'Cream Biscuits' }, { name: 'Marie & Digestive' }, { name: 'Glucose & Milk Biscuits' }] },
      { name: 'Snacks & Namkeen', children: [{ name: 'Chips & Wafers' }, { name: 'Bhujia & Mixture' }, { name: 'Roasted & Baked Snacks' }] },
      { name: 'Noodles, Pasta & Vermicelli', children: [{ name: 'Instant Noodles' }, { name: 'Pasta & Macaroni' }, { name: 'Vermicelli' }] },
      { name: 'Breakfast Cereals', children: [{ name: 'Cornflakes' }, { name: 'Oats' }, { name: 'Muesli & Granola' }] },
      { name: 'Chocolates & Candies', children: [{ name: 'Chocolate Bars' }, { name: 'Candies & Toffees' }, { name: 'Gift Packs' }] },
      { name: 'Ready To Cook & Eat', children: [{ name: 'Instant Mixes' }, { name: 'Ready Meals' }, { name: 'Soups' }] },
      { name: 'Spreads, Sauces & Ketchup', children: [{ name: 'Jam & Honey' }, { name: 'Ketchup & Sauces' }, { name: 'Mayonnaise & Dips' }] },
      { name: 'Pickles & Chutney', children: [{ name: 'Mango Pickle' }, { name: 'Mixed Pickle' }, { name: 'Chutney & Podi' }] },
    ],
  },
  {
    channel: CHANNEL.GROCERY,
    name: 'Beverages',
    children: [
      { name: 'Tea', children: [{ name: 'Black Tea' }, { name: 'Green Tea' }, { name: 'Tea Bags' }] },
      { name: 'Coffee', children: [{ name: 'Instant Coffee' }, { name: 'Filter Coffee' }, { name: 'Coffee Beans' }] },
      { name: 'Fruit Juices', children: [{ name: 'Tetra Pack Juices' }, { name: 'Fresh Juices' }, { name: 'Squash & Concentrates' }] },
      { name: 'Energy & Soft Drinks', children: [{ name: 'Soft Drinks' }, { name: 'Energy Drinks' }, { name: 'Soda & Mixers' }] },
      { name: 'Health Drinks & Supplements', children: [{ name: 'Malt Drinks' }, { name: 'Protein Supplements' }, { name: 'Kids Nutrition' }] },
      { name: 'Water', children: [{ name: 'Packaged Drinking Water' }, { name: 'Mineral Water' }, { name: 'Water Cans' }] },
    ],
  },
  {
    channel: CHANNEL.GROCERY,
    name: 'Personal Care',
    children: [
      { name: 'Hair Care', children: [{ name: 'Shampoo' }, { name: 'Hair Oil' }, { name: 'Conditioner & Serum' }] },
      { name: 'Oral Care', children: [{ name: 'Toothpaste' }, { name: 'Toothbrush' }, { name: 'Mouthwash' }] },
      { name: 'Skin Care', children: [{ name: 'Face Wash' }, { name: 'Moisturiser & Cream' }, { name: 'Sunscreen' }] },
      { name: 'Bath & Hand Wash', children: [{ name: 'Bathing Soap' }, { name: 'Body Wash' }, { name: 'Handwash & Sanitiser' }] },
      { name: 'Feminine Hygiene', children: [{ name: 'Sanitary Pads' }, { name: 'Intimate Wash' }, { name: 'Menstrual Cups' }] },
      { name: "Men's Grooming", children: [{ name: 'Shaving Cream & Gel' }, { name: 'Razors & Blades' }, { name: 'Beard Care' }] },
      { name: 'Deo & Fragrances', children: [{ name: 'Deodorants' }, { name: 'Perfumes' }, { name: 'Talc & Powder' }] },
    ],
  },
  {
    channel: CHANNEL.GROCERY,
    name: 'Home Care',
    children: [
      { name: 'Detergents', children: [{ name: 'Washing Powder' }, { name: 'Liquid Detergent' }, { name: 'Fabric Conditioner' }] },
      { name: 'Dishwash', children: [{ name: 'Dishwash Bar' }, { name: 'Dishwash Liquid' }, { name: 'Scrubbers & Sponges' }] },
      { name: 'All Purpose Cleaners', children: [{ name: 'Floor Cleaner' }, { name: 'Toilet Cleaner' }, { name: 'Glass & Surface Cleaner' }] },
      { name: 'Fresheners & Repellents', children: [{ name: 'Air Fresheners' }, { name: 'Mosquito Repellents' }, { name: 'Naphthalene Balls' }] },
      { name: 'Mops, Brushes & Scrubs', children: [{ name: 'Mops & Wipers' }, { name: 'Brooms' }, { name: 'Cleaning Brushes' }] },
      { name: 'Disposables & Garbage Bags', children: [{ name: 'Garbage Bags' }, { name: 'Foil & Cling Wrap' }, { name: 'Paper Napkins' }] },
      { name: 'Pooja Needs', children: [{ name: 'Agarbatti & Dhoop' }, { name: 'Diya & Wicks' }, { name: 'Camphor & Kumkum' }] },
    ],
  },
  {
    channel: CHANNEL.GROCERY,
    name: 'Baby Care',
    children: [
      { name: 'Diapers & Wipes', children: [{ name: 'Taped Diapers' }, { name: 'Pant Diapers' }, { name: 'Baby Wipes' }] },
      { name: 'Baby Bath & Hygiene', children: [{ name: 'Baby Soap' }, { name: 'Baby Shampoo' }, { name: 'Baby Lotion & Oil' }] },
      { name: 'Baby Food', children: [{ name: 'Infant Formula' }, { name: 'Baby Cereal' }, { name: 'Purees & Snacks' }] },
    ],
  },

  // ==========================================================================
  // SHG MARKETPLACE
  // ==========================================================================
  {
    channel: CHANNEL.SHG,
    name: 'Homemade Foods',
    children: [
      { name: 'Homemade Pickles', children: [{ name: 'Mango Pickle' }, { name: 'Lemon Pickle' }, { name: 'Mixed Vegetable Pickle' }] },
      { name: 'Papad & Masala', children: [{ name: 'Urad Papad' }, { name: 'Moong Papad' }, { name: 'Homemade Masala' }] },
      { name: 'Organic Honey & Jaggery', children: [{ name: 'Forest Honey' }, { name: 'Organic Jaggery' }, { name: 'Jaggery Powder' }] },
    ],
  },
  {
    channel: CHANNEL.SHG,
    name: 'Handloom & Textiles',
    children: [
      { name: 'Handloom Textiles', children: [{ name: 'Cotton Sarees' }, { name: 'Dupattas & Stoles' }, { name: 'Bed Linen' }] },
      { name: 'Jute & Cane Products', children: [{ name: 'Jute Bags' }, { name: 'Cane Baskets' }, { name: 'Jute Mats' }] },
    ],
  },
  {
    channel: CHANNEL.SHG,
    name: 'Handmade Crafts',
    children: [
      { name: 'Handmade Soaps & Candles', children: [{ name: 'Herbal Soaps' }, { name: 'Soy Candles' }, { name: 'Aroma Candles' }] },
      { name: 'Home Decor', children: [{ name: 'Wall Hangings' }, { name: 'Terracotta' }, { name: 'Bamboo Crafts' }] },
    ],
  },
];

/** Flat counts, for the seeder's summary line. */
export const countTree = () => {
  let l1 = 0, l2 = 0, l3 = 0;
  for (const a of categoryTree) {
    l1 += 1;
    for (const b of a.children || []) {
      l2 += 1;
      l3 += (b.children || []).length;
    }
  }
  return { l1, l2, l3, total: l1 + l2 + l3 };
};
