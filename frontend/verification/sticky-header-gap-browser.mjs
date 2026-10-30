import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
// Pinned headers must sit flush with the top of their scroll area. A header that
// sticks a few pixels lower lets scrolled content show above it (a sticky element
// pins to the scroll container's padding edge, not its border edge).
// Reuses the isolated CDP/fixture runner's --sticky-headers audit and adds the gap.
const generated = new URL(`../tests/.sticky-gap-${process.pid}.mjs`, import.meta.url);
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
const marker = "          const result = { scrollable: true, scroller: describe(scroller), moved, header: describe(header), position: header && getComputedStyle(header).position, before, after,";
assert.ok(source.includes(marker), 'Sticky audit marker missing from tests/mobile-layout.test.mjs');
source = source.replace(marker, `          const edge = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top + parseFloat(getComputedStyle(scroller).borderTopWidth);
          const pinned = header && getComputedStyle(header).position === 'sticky' && after > before - moved + 2;
          const gap = pinned ? Math.round((after - edge) * 10) / 10 : 0;
${marker} gap, pinned,`);
await writeFile(generated, source);
const paths = process.argv.find(arg => arg.startsWith('--paths='))?.slice(8) || [
  '/delivery/dashboard', '/delivery/history', '/delivery/returns', '/delivery/support', '/delivery/profile',
  '/account', '/orders', '/categories', '/wishlist', '/ebooks', '/services', '/legal-services', '/parcel-delivery',
  '/cart', '/checkout', '/search', '/wholesale', '/wholesale/cart',
].join(',');
const widths = process.argv.find(arg => arg.startsWith('--widths='))?.slice(9) || '360,390';
try {
  const code = await new Promise(resolve => spawn(process.execPath, [generated.pathname.replace(/^\/([A-Z]:)/, '$1'), '--full', '--sticky-headers', '--label=sticky-gap', `--paths=${paths}`, `--widths=${widths}`], { stdio: 'inherit' }).on('exit', resolve));
  assert.equal(code, 0, 'Layout runner failed');
} finally { await rm(generated, { force: true }); }
const failures = [];
// The runner's last result file holds every width's rows.
const { rows } = JSON.parse(await readFile(new URL(`../../test-artifacts/mobile-native/sticky-gap-${widths.split(',').at(-1)}.json`, import.meta.url), 'utf8'));
{
  for (const row of rows.filter(r => r.header)) {
    const width = row.width;
    console.log(`${String(width).padStart(4)} ${row.path.padEnd(22)} ${row.header.header || '-'} ${row.header.scrollable === false ? "not measured (no scroll area at this width)" : `position=${row.header.position} pinned=${row.header.pinned} gap=${row.header.gap}`}`);
    if (row.header.gap > 1) failures.push(`${row.path}@${width}: ${row.header.header} pinned ${row.header.gap}px below the top of ${row.header.scroller}`);
  }
}
assert.deepEqual(failures, [], 'Scrolled content must not show above a pinned header');
console.log('No pinned header leaves a gap above it.');
