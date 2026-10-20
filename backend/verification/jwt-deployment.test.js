import { auditJwtProcesses } from '../services/jwtDeploymentAudit.service.js';
const script = '/fixture/backend/index.js';
const secret = 'private-fixture-intended-key';
const worker = (pm_id, overrides = {}) => ({ pm_id, pm2_env: { pm_exec_path: script, NODE_ENV: 'production', status: 'online', ...overrides } });
const audit = workers => auditJwtProcesses(workers, { script, secret });

test('matching replicas pass without exposing the intended or worker key', () => {
  const result = audit([worker(0, { JWT_SECRET: secret }), worker(1, { JWT_SECRET: secret })]);
  expect(result.launchConfigurationConsistent).toBe(true);
  expect(result.workers.every(w => w.runningKeyVerified === false)).toBe(true);
  expect(JSON.stringify(result)).not.toContain(secret);
});
test('a stale PM2 override is identified without exposing either key', () => {
  const result = audit([worker(0), worker(1, { JWT_SECRET: 'private-fixture-stale-key' })]);
  expect(result.launchConfigurationConsistent).toBe(false);
  expect(result.workers[1].secretMatchesIntended).toBe(false);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain('private-fixture-stale-key');
});
test.each([
  [], [worker(0, { NODE_ENV: 'development' })], [worker(0, { pm_exec_path: '/other/index.js' })],
  [worker(0, { JWT_EXPIRES_IN: '1h' })], [worker(0, { JWT_SECRET: '' })],
].map(workers => [workers]))('missing or inconsistent launch configuration fails closed', workers => {
  expect(audit(workers).launchConfigurationConsistent).toBe(false);
});
test('missing intended production key cannot pass an audit', () => {
  expect(auditJwtProcesses([worker(0)], { script }).launchConfigurationConsistent).toBe(false);
});
