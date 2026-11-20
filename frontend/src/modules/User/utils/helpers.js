/**
 * Rupees for display, the same rule as the customer app's money(): whole amounts without decimals
 * (₹1,000), anything with paise to two places (₹119.40). Indian digit grouping.
 * @param {number|string} value The amount in rupees.
 * @returns {string} e.g. ₹120, ₹1,20,000, ₹119.40
 */
export const formatCurrency = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '₹0';
  const whole = Math.abs(number - Math.round(number)) < 0.005;
  return '₹' + (whole ? Math.round(number) : number).toLocaleString('en-IN', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * Returns a placeholder avatar initials or similar utility
 */
export const getInitials = (name) => {
  if (!name) return '';
  return name.split(' ').map(n => n[0]).join('').toUpperCase();
};
