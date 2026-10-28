export function validateBulkRows(rows, categories, imageMap = new Map()) {
  const errors = [], products = [];
  const read = (row, ...keys) => String(keys.map(key => row[key]).find(value => value !== undefined && value !== null && String(value).trim() !== '') ?? '').trim();
  const header = Object.keys(rows[0] || {});
  const required = [['Product Name', 'Name', 'product name'], ['Main Category', 'Category', 'Header Category', 'Header'], ['Sell Price (₹)', 'Price (₹)', 'Price', 'price'], ['Stock', 'stock']];
  const missing = required.filter(names => !names.some(name => header.includes(name))).map(names => names[0]);
  if (missing.length) return { products, errors: [{ row: 1, reason: `Missing required columns: ${missing.join(', ')}. Download the latest template.` }] };
  for (const [index, row] of rows.entries()) {
    const name = read(row, 'Product Name', 'product name', 'Name');
    if (name.startsWith('#') || name.includes('[EXAMPLE]') || name.includes('DO NOT EDIT')) continue;
    const issues = [];
    const rowNumber = row.__rowNumber || index + 2;
    if (!name) issues.push('Product Name is required');
    const main = read(row, 'Main Category', 'Category'), headerName = read(row, 'Header Category', 'Header'), sub = read(row, 'Sub Category', 'Subcategory');
    const matches = text => categories.filter(category => category.name.trim().toLowerCase() === text.toLowerCase());
    const headerCategory = headerName ? matches(headerName)[0] : null;
    const mainMatches = matches(main || headerName);
    const category = mainMatches.find(candidate => !headerCategory || !main || String(candidate.parent) === String(headerCategory._id) || String(candidate._id) === String(headerCategory._id));
    const subCategory = sub ? matches(sub).find(candidate => String(candidate.parent) === String(category?._id)) : null;
    if (headerName && !headerCategory) issues.push(`Header Category '${headerName}' does not exist in this storefront`);
    if (!category) issues.push(`Main Category '${main || headerName}' is invalid for the selected header and storefront`);
    if (sub && !subCategory) issues.push(`Sub Category '${sub}' does not belong to the main category`);
    const rawPrice = read(row, 'Sell Price (₹)', 'Price (₹)', 'Price', 'price');
    const price = Number(rawPrice);
    const mrp = Number(read(row, 'MRP Price (₹)', 'MRP (₹)', 'MRP', 'mrp') || rawPrice);
    if (!rawPrice || !Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(Math.round(price * 100)) || Math.abs(price * 100 - Math.round(price * 100)) > 0.00001) issues.push('Sell Price must be a positive number with at most two decimal places');
    if (!Number.isFinite(mrp) || mrp < price || Math.abs(mrp * 100 - Math.round(mrp * 100)) > 0.00001) issues.push('MRP must be a number at least equal to Sell Price, with at most two decimal places');
    const rawStock = read(row, 'Stock', 'stock'), stock = Number(rawStock);
    if (!rawStock || !Number.isSafeInteger(stock) || stock < 0) issues.push('Stock is required and must be a whole number of zero or more');
    const unit = (read(row, 'Unit') || 'piece').toLowerCase();
    if (!['kg', 'g', 'litre', 'ml', 'piece', 'dozen', 'pack'].includes(unit)) issues.push('Unit must be kg, g, litre, ml, piece, dozen or pack');
    const images = [['Primary Image URL', 'Primary Image'], ['Front Image URL', 'Front Image'], ['Back Image URL', 'Back Image']].map(keys => read(row, ...keys)).filter(Boolean);
    for (const image of images) {
      if (/^https?:\/\//i.test(image)) { try { new URL(image); } catch { issues.push(`Invalid image URL: ${image}`); } }
      else if (!imageMap.has(image.toLowerCase())) issues.push(`Image '${image}' is missing from the ZIP archive. Upload the matching ZIP or use an HTTP(S) image URL`);
    }
    if (issues.length) { errors.push({ row: rowNumber, name, reason: issues.join('; ') }); continue; }
    products.push({ row: rowNumber, images, data: { name, category: category._id, subCategory: subCategory?._id,
      price, mrp, stock, unit, brand: read(row, 'Brand') || undefined, variantName: read(row, 'Variant Name') || undefined,
      description: read(row, 'Product Description', 'Description') || name, specifications: read(row, 'Specifications') || undefined,
      tags: read(row, 'Search Tags', 'Tags').split(',').map(tag => tag.trim()).filter(Boolean) } });
  }
  return { products, errors };
}
