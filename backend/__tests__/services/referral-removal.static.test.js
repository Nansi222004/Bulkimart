import fs from 'node:fs';
import path from 'node:path';

const backendRoot = path.resolve(import.meta.dirname, '../..');
const repoRoot = path.resolve(backendRoot, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('removed API, service, controller, configuration, and model modules are absent', () => {
  [
    'backend/routes/referral.routes.js',
    'backend/controllers/referral.controller.js',
    'backend/controllers/referralAdmin.controller.js',
    'backend/services/referral.service.js',
    'backend/services/referralConfig.service.js',
    'backend/models/Referral.js',
    'backend/models/ReferralConfig.js',
    'backend/models/ReferralMilestone.js',
  ].forEach((relativePath) => {
    expect(fs.existsSync(path.join(repoRoot, relativePath))).toBe(false);
  });
});

test('signup, order, payment, and scheduled jobs contain no active reward hook', () => {
  [
    'backend/controllers/auth.controller.js',
    'backend/controllers/order.controller.js',
    'backend/controllers/payment.controller.js',
    'backend/services/orderSweeper.service.js',
    'backend/index.js',
  ].forEach((relativePath) => {
    expect(read(relativePath)).not.toMatch(/captureReferral|sweepReferral|payoutReferral|referral\.service|loadReferralConfig/i);
  });
});

test('customer and admin route registries expose no retired endpoints', () => {
  expect(read('backend/routes/index.js')).not.toMatch(/referralRoutes|use\(["']\/referrals/i);
  expect(read('backend/routes/admin.routes.js')).not.toMatch(/["']\/referrals|["']\/referral-settings/i);
});

test('customer registration and profile source no longer carries invite state or API calls', () => {
  const customerSource = [
    read('forntend/src/modules/User/context/UserContext.jsx'),
    read('forntend/src/modules/User/pages/AuthPage.jsx'),
    read('forntend/src/modules/User/pages/ProfilePage.jsx'),
  ].join('\n');
  expect(customerSource).not.toMatch(/pendingReferralCode|\/api\/referrals|referralCode|Refer & Earn|Invite Friends/i);
});

test('generic Coins and wallet modules remain present', () => {
  [
    'backend/services/coin.service.js',
    'backend/models/CoinTransaction.js',
    'backend/models/CoinWallet.js',
    'backend/routes/coin.routes.js',
    'backend/routes/wallet.routes.js',
  ].forEach((relativePath) => {
    expect(fs.existsSync(path.join(repoRoot, relativePath))).toBe(true);
  });
});
