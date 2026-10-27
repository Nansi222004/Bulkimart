import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
// The categories grid and one category's own products page in the real customer
// app, through the isolated CDP/fixture runner's layout checks, with a fixture
// tree that actually has a category and subcategories.
const generated = new URL(`../tests/.categories-${process.pid}.mjs`, import.meta.url);
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
const marker = "  if (path === '/api/categories/tree' || path === '/api/banners') return [];";
assert.ok(source.includes(marker), 'Category tree fixture marker missing from tests/mobile-layout.test.mjs');
const child = (id, name, slug) => ({ _id: id, name, slug: `grocery--fresh--${slug}`, type: 'grocery', isActive: true, children: [] });
const tree = [{ _id: '507f1f77bcf86cd799439080', name: 'Fresh', slug: 'grocery--fresh', type: 'grocery', isActive: true, children: [
  child('507f1f77bcf86cd799439081', 'Fruits', 'fruits'), child('507f1f77bcf86cd799439082', 'Vegetables', 'vegetables'), child('507f1f77bcf86cd799439083', 'Dairy & eggs', 'dairy'),
] }, { _id: '507f1f77bcf86cd799439084', name: 'Staples', slug: 'grocery--staples', type: 'grocery', isActive: true, children: [] }];
source = source.replace(marker, `  if (path === '/api/categories/tree') return ${JSON.stringify(tree)};\n  if (path === '/api/banners') return [];`);
await writeFile(generated, source);
const widths = process.argv.find(arg => arg.startsWith('--widths='))?.slice(9) || '360,412';
try {
  const code = await new Promise(resolve => spawn(process.execPath, [generated.pathname.replace(/^\/([A-Z]:)/, '$1'), '--full', '--sticky-headers', '--label=categories',
    '--paths=/categories,/categories/grocery--fresh', `--widths=${widths}`], { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).on('exit', resolve));
  assert.equal(code, 0, 'Layout runner failed');
} finally { await rm(generated, { force: true }); }
console.log('Categories grid and category page pass the layout checks; screenshots in test-artifacts/sticky-headers/categories-*.png');
