import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// Reproduce Hostinger's backend-only nodejs directory, without the repository's
// sibling shared directory. This executes the import that broke production.
const temporary = await mkdtemp(join(tmpdir(), 'bulkimart-service-package-'));
try {
  const packaged = join(temporary, 'nodejs');
  await mkdir(join(packaged, 'services'), { recursive: true });
  await mkdir(join(packaged, 'shared'));
  await writeFile(join(packaged, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const file of ['services/serviceForms.service.js', 'shared/serviceLimits.mjs']) {
    await copyFile(new URL('../' + file, import.meta.url), join(packaged, file));
  }
  const forms = await import(pathToFileURL(join(packaged, 'services/serviceForms.service.js')).href);
  assert.equal(typeof forms.validateDefinition, 'function');
  const limits = await import(pathToFileURL(join(packaged, 'shared/serviceLimits.mjs')).href);
  assert.equal(typeof limits.serializedAnswerBytes, 'function');
  console.log('Backend-only service package import and shared limits: passed');
} finally {
  // Only the test-owned directory returned by mkdtemp is removed.
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert.ok(basename(temporary).startsWith('bulkimart-service-package-'));
  await rm(temporary, { recursive: true, force: true });
}
