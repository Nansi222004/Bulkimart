/**
 * Formats a number as Indian Rupee (INR) currency.
 * @param {number} value The numerical value to format.
 * @returns {string} Formatted price string (e.g. ₹120)
 */
export const formatCurrency = (value) => {
  return `₹${value}`;
};

/**
 * Returns a placeholder avatar initials or similar utility
 */
export const getInitials = (name) => {
  if (!name) return '';
  return name.split(' ').map(n => n[0]).join('').toUpperCase();
};
