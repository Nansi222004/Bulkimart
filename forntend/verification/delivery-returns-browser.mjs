import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
// Return pickups list and full-page pickup in the real rider shell, through the
// isolated CDP/fixture runner's layout checks (overflow, clipped controls) with
// a fixture that actually has a new request, an active pickup and a completed one.
const id = '507f1f77bcf86cd799439071';
const generated = new URL(`../tests/.delivery-returns-${process.pid}.mjs`, import.meta.url);
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
const marker = "  if (path === '/api/delivery/return-pickups') return { success:true,data:{pending:[],active:[]} };";
assert.ok(source.includes(marker), 'Return pickups fixture marker missing from tests/mobile-layout.test.mjs');
const address = { name: 'Nansi Tiwari', line1: 'B block, Regal Square', city: 'Indore', pincode: '452001', lat: 22.7196, lng: 75.8577 };
const store = { name: 'Always Fresh Store', address: 'South Tukoganj', city: 'Indore', lat: 22.7176, lng: 75.8697 };
// A pending offer also opens the global accept/decline popup (existing behavior),
// which would cover the screens under test; --with-offer includes one anyway.
const withOffer = process.argv.includes('--with-offer');
const data = {
  pending: !withOffer ? [] : [{ _id: '507f1f77bcf86cd799439070', returnNumber: 'RET-20261027-NEWREQ', productName: 'Organic Toor Dal 1 kg', quantity: 2, pickup: { status: 'OFFERED' } }],
  active: [{ _id: id, returnNumber: 'RET-20261027-SQQDEN', productName: 'Amla', quantity: 1, orderId: { shippingAddress: address }, sellerId: { businessName: 'Always Fresh Store', storeDetails: store }, pickup: { status: 'ASSIGNED' } }],
  history: [{ _id: '507f1f77bcf86cd799439072', returnNumber: 'RET-20261020-DONE01', productName: 'Ghee 500 ml', quantity: 1, sellerId: { businessName: 'Always Fresh Store' }, pickup: { status: 'DELIVERED_TO_SELLER', deliveryId: { partnerEarnings: 35, endTime: '2026-10-20T10:00:00Z' } } }],
};
source = source.replace(marker, `  if (path === '/api/delivery/return-pickups') return { success:true,data:${JSON.stringify(data)} };`);
await writeFile(generated, source);
const widths = process.argv.find(arg => arg.startsWith('--widths='))?.slice(9) || '360,390,430';
try {
  const code = await new Promise(resolve => spawn(process.execPath, [generated.pathname.replace(/^\/([A-Z]:)/, '$1'), '--full', '--sticky-headers', '--label=delivery-returns',
    `--paths=/delivery/returns,/delivery/returns/${id}`, `--widths=${widths}`], { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).on('exit', resolve));
  assert.equal(code, 0, 'Layout runner failed');
} finally { await rm(generated, { force: true }); }
console.log('Return pickups list and pickup page pass the layout checks; screenshots in test-artifacts/sticky-headers/delivery-returns-*.png');
