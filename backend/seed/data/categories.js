import { CHANNEL } from '../../constants/enums.js';
import { ID, img } from '../ids.js';

/**
 * E-commerce and grocery parents with their subcategories.
 * Numbering: parents 1..24, children 101+.
 */

const parent = (n, name, type, sortOrder) => ({
  _id: ID.cat(n),
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
  type,
  parent: null,
  image: img(name),
  icon: img(name, 128, 128),
  sortOrder,
  isActive: true,
});

const child = (n, name, type, parentN, sortOrder) => ({
  _id: ID.cat(n),
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
  type,
  parent: ID.cat(parentN),
  image: img(name),
  sortOrder,
  isActive: true,
});

const E = CHANNEL.ECOM;
const G = CHANNEL.GROCERY;

export const categories = [
  // ---------------------------------------------------------- E-COMMERCE (8)
  parent(1, 'Garments', E, 1),
  parent(2, 'Household Essentials', E, 2),
  parent(3, 'Handicrafts', E, 3),
  parent(4, 'Electronics', E, 4),
  parent(5, 'Footwear', E, 5),
  parent(6, 'Kitchenware', E, 6),
  parent(7, 'Beauty and Personal Care', E, 7),
  parent(8, 'Books and Stationery', E, 8),

  child(101, 'Mens Wear', E, 1, 1),
  child(102, 'Womens Wear', E, 1, 2),
  child(103, 'Kids Wear', E, 1, 3),
  child(104, 'Cleaning Supplies', E, 2, 1),
  child(105, 'Storage and Organisers', E, 2, 2),
  child(106, 'Wooden Crafts', E, 3, 1),
  child(107, 'Bamboo Products', E, 3, 2),
  child(108, 'Mobile Accessories', E, 4, 1),
  child(109, 'Small Appliances', E, 4, 2),
  child(110, 'Cookware', E, 6, 1),

  // ---------------------------------------------------------- GROCERY (10)
  parent(9, 'Atta Rice and Dal', G, 1),
  parent(10, 'Oil and Ghee', G, 2),
  parent(11, 'Masala and Spices', G, 3),
  parent(12, 'Dairy and Bakery', G, 4),
  parent(13, 'Fruits and Vegetables', G, 5),
  parent(14, 'Snacks and Namkeen', G, 6),
  parent(15, 'Tea Coffee and Beverages', G, 7),
  parent(16, 'Cleaning and Household', G, 8),
  parent(17, 'Personal Care', G, 9),
  parent(18, 'Baby Care', G, 10),

  child(201, 'Basmati Rice', G, 9, 1),
  child(202, 'Wheat Atta', G, 9, 2),
  child(203, 'Toor and Moong Dal', G, 9, 3),
  child(204, 'Mustard Oil', G, 10, 1),
  child(205, 'Refined Oil', G, 10, 2),
  child(206, 'Whole Spices', G, 11, 1),
  child(207, 'Ground Spices', G, 11, 2),
  child(208, 'Milk and Paneer', G, 12, 1),
  child(209, 'Bread and Biscuits', G, 12, 2),
  child(210, 'Fresh Vegetables', G, 13, 1),
  child(211, 'Seasonal Fruits', G, 13, 2),

];
