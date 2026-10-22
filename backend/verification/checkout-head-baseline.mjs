// Reproduce the existing local checkout test against HEAD without editing the
// user's working files. Only test-owned temporary files are created/removed.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const backend = fileURLToPath(new URL('../', import.meta.url)), repo = path.resolve(backend, '..');
const temp = await mkdtemp(path.join(backend, '.legal-checkout-baseline-'));
try {
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', 'backend'], { cwd: repo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(p => /^backend\/(controllers|models|routes|services|middlewares|config|constants|socket|shared|utils)\/.*\.(js|mjs|json)$/.test(p) || p === 'backend/package.json');
  const archive = path.join(temp, 'head.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, 'HEAD', ...files], { cwd: repo });
  execFileSync('tar', ['-xf', archive, '--strip-components=1', '-C', temp]);
  for (const rel of ['__tests__/jest.config.js', '__tests__/setup/env.js', '__tests__/api/checkout-workflow.http.test.js']) {
    const target = path.join(temp, rel); await mkdir(path.dirname(target), { recursive: true }); await copyFile(path.join(backend, rel), target);
  }
  const output = path.join(temp, 'result.json');
  const run = spawnSync(process.execPath, ['--experimental-vm-modules', path.join(backend, 'node_modules/jest/bin/jest.js'), '--config', '__tests__/jest.config.js', '--runInBand', '--json', `--outputFile=${output}`, '__tests__/api/checkout-workflow.http.test.js'], { cwd: temp, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, NODE_ENV: 'test' } });
  const r = JSON.parse(await readFile(output, 'utf8'));
  console.log(JSON.stringify({ commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), exitCode: run.status, passed: r.numPassedTests, failed: r.numFailedTests, failures: r.testResults.flatMap(s => s.assertionResults.filter(t => t.status === 'failed').map(t => ({ title: t.fullName, message: t.failureMessages[0]?.slice(0, 450) }))) }, null, 2));
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(backend)); assert.ok(path.basename(temp).startsWith('.legal-checkout-baseline-')); await rm(temp, { recursive: true, force: true });
}
