import fs from 'node:fs';
import path from 'node:path';

const readFrontend = (relativePath) => fs.readFileSync(
  path.resolve(process.cwd(), '../forntend/src/modules/User', relativePath),
  'utf8',
);

test('customer authentication UI has no client-side login bypass', () => {
  const authPage = readFrontend('pages/AuthPage.jsx');
  const context = readFrontend('context/UserContext.jsx');

  expect(authPage).not.toMatch(/guest@example\.com|social@example\.com|loginUser\s*\(/);
  expect(context).not.toMatch(/const\s+loginUser\s*=|const\s+registerUser\s*=/);
  expect(authPage).toMatch(/onClick=\{\(\) => setActiveNav\('home'\)\}/);
});

test('a cached customer profile alone cannot restore an authenticated session', () => {
  const context = readFrontend('context/UserContext.jsx');
  expect(context).toMatch(/const token = localStorage\.getItem\('userToken'\)/);
  expect(context).toMatch(/if \(!token \|\| !saved\)/);
});
