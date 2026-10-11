import subscriptionRoutes from '../../routes/subscription.routes.js';
import premiumRoutes from '../../routes/premium.routes.js';
import adminRoutes from '../../routes/admin.routes.js';
import apiRoutes from '../../routes/index.js';
import subscriptionBasketRoutes from '../../routes/subscriptionBasket.routes.js';

const signatures = (router) => router.stack
  .filter((layer) => layer.route)
  .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));

describe('retired subscription acquisition routes', () => {
  test('customer subscription creation and basket calculation are not registered', () => {
    const routes = signatures(subscriptionRoutes);
    expect(routes).not.toContain('POST /');
    expect(routes).not.toContain('POST /basket');
    expect(routes).toContain('GET /'); // historical customer records remain readable
  });

  test('premium plan discovery and purchase are not registered', () => {
    const routes = signatures(premiumRoutes);
    expect(routes).not.toContain('GET /plans');
    expect(routes).not.toContain('POST /purchase');
    expect(routes).toContain('GET /me'); // historical membership state remains readable
  });

  test('admin premium plan management and recurring basket mounts are absent', () => {
    expect(signatures(adminRoutes).some((route) => route.includes('/premium-plans'))).toBe(false);
    const rootMounts = apiRoutes.stack.filter((layer) => layer.name === 'router');
    expect(rootMounts.some((layer) => layer.handle === subscriptionBasketRoutes)).toBe(false);
  });
});
