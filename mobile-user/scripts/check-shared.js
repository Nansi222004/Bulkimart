// The storefront and celebration rules are copied verbatim from the backend's shared modules (the web imports
// them directly). This fails when a copy has drifted, so the app never applies different rules from the web.
const fs = require('fs');
const path = require('path');
const pairs = [['src/shared/storefront.js', '../backend/shared/storefront.mjs'], ['src/shared/celebration.js', '../backend/shared/celebration.mjs'], ['src/shared/serviceLimits.js', '../backend/shared/serviceLimits.mjs']];
let failed = false;
for (const [copy, source] of pairs) {
  const a = fs.readFileSync(path.join(__dirname, '..', copy), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', source), 'utf8');
  if (a !== b) { failed = true; console.error(`${copy} differs from ${source}. Copy the backend file again.`); }
}
if (failed) process.exit(1);
console.log('Shared storefront rules match the backend.');
