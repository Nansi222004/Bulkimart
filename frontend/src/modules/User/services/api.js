import { PRODUCTS, POPULAR_CATEGORIES } from '../constants';

/**
 * Mock API services for the NHCONE landing page.
 */
export const fetchProducts = async () => {
  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 300));
  return PRODUCTS;
};

export const fetchCategories = async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return POPULAR_CATEGORIES;
};
