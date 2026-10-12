import { CHANNEL } from '../../constants/enums.js';
import { ID, img } from '../ids.js';

/** One per placement type. Banner APIs land in Day 2 Block 6a. */
export const banners = [
  {
    _id: ID.banner(1),
    title: 'Festive Fashion Sale — up to 50% off',
    image: img('Festive Fashion Sale', 1200, 400),
    targetRoute: '/products?type=ecommerce&cat=garments',
    type: CHANNEL.ECOM,
    isActive: true,
    priority: 10,
    startDate: new Date('2026-08-01'),
    endDate: new Date('2026-12-31'),
  },
  {
    _id: ID.banner(2),
    title: 'Groceries delivered in 30 minutes',
    image: img('Quick Grocery Delivery', 1200, 400),
    targetRoute: '/grocery',
    type: CHANNEL.GROCERY,
    isActive: true,
    priority: 9,
    startDate: new Date('2026-08-01'),
    endDate: new Date('2026-12-31'),
  },
];
