// Live chat client code is copied (not linked) into each app. Fail when a copy drifts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('supportChatCore.js is identical in web and all three apps', () => {
  const source = read('frontend/src/utils/supportChatCore.js');
  for (const app of ['mobile-user', 'mobile-seller', 'mobile-delivery']) {
    assert.equal(read(`${app}/src/utils/supportChatCore.js`), source, `${app} copy differs — copy frontend/src/utils/supportChatCore.js again`);
  }
});

test('SupportChatView.js is identical in all three apps', () => {
  const source = read('mobile-seller/src/components/SupportChatView.js');
  for (const app of ['mobile-user', 'mobile-delivery']) {
    assert.equal(read(`${app}/src/components/SupportChatView.js`), source, `${app} copy differs — copy mobile-seller/src/components/SupportChatView.js again`);
  }
});
