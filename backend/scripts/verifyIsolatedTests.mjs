// Each Jest VM owns Mongoose models, indexes and one disposable DB lifecycle.
// Separate processes avoid cross-suite database/model state in the ESM runner.
import { spawn } from 'node:child_process';
import { readdir, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const backend = resolve(import.meta.dirname, '..');
const output = resolve(backend, '../test-artifacts/unified-basket/backend-suites');
await mkdir(output, { recursive: true });
const files = (await readdir(join(backend, '__tests__'), { recursive: true })).filter(file => file.endsWith('.test.js')).sort();
const results = [];
for (const file of files) {
  const name = file.replace(/[\\/.]/g, '_');
  const report = join(output, name + '.json');
  let log = '', timedOut = false;
  const child = spawn(process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--runInBand', '--runTestsByPath', join('__tests__', file), '--json', '--outputFile=' + report], { cwd: backend, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180000);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  clearTimeout(timer);
  await writeFile(join(output, name + '.log'), log);
  let data = {};
  try { data = JSON.parse(await readFile(report, 'utf8')); } catch { /* The log records startup/timeouts. */ }
  const result = { file, passed: code === 0 && !timedOut, tests: data.numPassedTests || 0, skipped: data.numPendingTests || 0, failed: data.numFailedTests || 0, timedOut };
  results.push(result); console.log(JSON.stringify(result));
  if (!result.passed) console.error(log.slice(-5000));
}
const summary = { passed: results.every(result => result.passed), suites: results.length,
  tests: results.reduce((n, result) => n + result.tests, 0), skipped: results.reduce((n, result) => n + result.skipped, 0), results };
await writeFile(resolve(output, '../backend-isolated.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, results: undefined }));
if (!summary.passed) process.exitCode = 1;
