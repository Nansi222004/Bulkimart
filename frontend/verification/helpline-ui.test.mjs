import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';

let vite, HelplineSettingsTab;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  const mod = await vite.ssrLoadModule('/src/modules/Admin/components/HelplineSettingsTab.jsx');
  HelplineSettingsTab = mod.HelplineSettingsTab || mod.default;
});

after(async () => vite.close());

const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');

test('HelplineSettingsTab renders all configurable phone inputs and default buttons', () => {
  const h = hookHarness(HelplineSettingsTab, {}, '/admin/helpline-settings');
  try {
    const rendered = text(h.tree);

    // Heading & overview
    assert.match(rendered, /Platform Helpline & Emergency SOS Settings/);
    assert.match(rendered, /Delivery Rider SOS Emergency Number/);
    assert.match(rendered, /Seller & General Platform Helplines/);

    // Form inputs & labels
    assert.match(rendered, /SOS PHONE \/ DIAL NUMBER/);
    assert.match(rendered, /SELLER SUPPORT HELPLINE/);
    assert.match(rendered, /BULKIMART CUSTOMER HELPLINE/);
    assert.match(rendered, /RIDER NON-EMERGENCY HELPDESK/);

    // Action buttons
    assert.match(rendered, /Save & Publish Helpline Settings/);
    assert.match(rendered, /Reset to Defaults/);

    // Live preview box
    assert.match(rendered, /Live App Preview/);
    assert.match(rendered, /SOS Emergency Helpline/);
  } finally {
    h.close();
  }
});
