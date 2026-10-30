import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Existing component tests expect cwd=forntend. Keep their assertions, but load
// the transparent verification config instead of the obfuscated default config.
const names = ['product-returns-ui', 'financial-workflow-ui', 'payment-ui', 'razorpay-overlay', 'shiprocket-fee-ui'];
const generated = [];
try {
  for (const name of names) {
    let source = await readFile(new URL(`./${name}.test.mjs`, import.meta.url), 'utf8');
    source = source.replace(/createServer\(\s*\{/g, 'createServer({configFile:"vite.return-verification.config.mjs",');
    const target = new URL(`./.return-${process.pid}-${name}.test.mjs`, import.meta.url);
    await writeFile(target, source); generated.push(target);
  }
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...generated.map(fileURLToPath)], { cwd: new URL('..', import.meta.url), stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.equal(code, 0);
} finally { await Promise.all(generated.map(path => rm(path, { force: true }))); }
