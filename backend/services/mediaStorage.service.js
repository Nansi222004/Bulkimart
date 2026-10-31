import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import { assertServerStorageConfig, getStorageConfig } from '../config/storage.js';

// Filesystem storage provider. The only module that knows real paths; callers
// deal in opaque storage keys. A future provider must implement the same
// methods: put, open, remove, health.
//
// Layout under MEDIA_ROOT (created by the operator; never auto-created, so an
// unmounted volume fails loudly instead of filling the OS disk):
//   public/<dir>/<yyyy>/<mm>/<uuid>.<ext>
//   private/<dir>/<yyyy>/<mm>/<uuid>.<ext>
//   temp/        in-flight writes, swept by mediaCleanup.service.js
//   quarantine/  legacy files that failed validation during migration

const KEY_PATTERN = /^(public|private|quarantine)\/[a-z0-9-]+\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(webp|jpg|png|pdf|mp4|bin)$/;

const storageError = (message, code = 'MEDIA_STORAGE_UNAVAILABLE', status = 503) => Object.assign(new Error(message), { status, code });

export const isValidStorageKey = (key) => KEY_PATTERN.test(String(key || ''));

const rootOrThrow = () => assertServerStorageConfig(getStorageConfig()).root;

export const tempDirectory = () => path.join(rootOrThrow(), 'temp');

/**
 * Absolute path for a key, guaranteed to stay inside MEDIA_ROOT (or `root`,
 * used only to verify a restored backup copy).
 */
export const resolveKey = (key, root = rootOrThrow()) => {
  if (!isValidStorageKey(key)) throw storageError('Invalid media key', 'MEDIA_KEY_INVALID', 400);
  const target = path.resolve(root, key);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw storageError('Invalid media key', 'MEDIA_KEY_INVALID', 400);
  return target;
};

export const buildStorageKey = ({ area, dir, ext, now = new Date() }) => {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${area}/${dir}/${yyyy}/${mm}/${randomUUID()}.${ext}`;
};

const assertRootUsable = async (root) => {
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('not a directory');
  } catch {
    throw storageError('Media storage is unavailable. Please try again later.');
  }
};

export const freeBytes = async (root = rootOrThrow()) => {
  const info = await statfs(root);
  return Number(info.bavail) * Number(info.bsize);
};

const assertSpace = async (root, incoming) => {
  const { minFreeBytes } = getStorageConfig();
  let available;
  try { available = await freeBytes(root); } catch { throw storageError('Media storage is unavailable. Please try again later.'); }
  if (available - incoming < minFreeBytes) {
    throw storageError('Media storage is full. Please try again later.', 'MEDIA_STORAGE_FULL', 507);
  }
};

const hashFile = (filePath) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  let size = 0;
  createReadStream(filePath)
    .on('data', (chunk) => { size += chunk.length; hash.update(chunk); })
    .on('error', reject)
    .on('end', () => resolve({ sha256: hash.digest('hex'), sizeBytes: size }));
});

const writeDurably = async (target, source) => {
  const handle = await open(target, 'wx', 0o600);
  try {
    if (source.buffer) {
      await handle.writeFile(source.buffer);
    } else {
      const reader = createReadStream(source.filePath);
      for await (const chunk of reader) await handle.write(chunk);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
};

/**
 * Store bytes under `key`. Writes to temp, fsyncs, re-reads and verifies the
 * SHA-256 and size, then atomically renames into place. Success is returned
 * only after the durable file is verified.
 * source: { buffer } or { filePath }; expected: optional { sha256, sizeBytes }.
 */
export const put = async ({ key, source, visibility, expected = null }) => {
  const root = rootOrThrow();
  await assertRootUsable(root);
  const target = resolveKey(key);
  const incoming = source.buffer ? source.buffer.length : (await lstat(source.filePath)).size;
  await assertSpace(root, incoming);

  const tempDir = path.join(root, 'temp');
  const temporary = path.join(tempDir, `${randomUUID()}.partial`);
  try {
    await mkdir(tempDir, { recursive: true, mode: 0o700 });
    await writeDurably(temporary, source);
    const written = await hashFile(temporary);
    const want = expected || (source.buffer
      ? { sha256: createHash('sha256').update(source.buffer).digest('hex'), sizeBytes: source.buffer.length }
      : null);
    if (want && (written.sha256 !== want.sha256 || written.sizeBytes !== want.sizeBytes)) {
      throw new Error('verification failed');
    }
    await mkdir(path.dirname(target), { recursive: true, mode: visibility === 'public' ? 0o750 : 0o700 });
    try { await lstat(target); throw new Error('key collision'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(temporary, target);
    await chmod(target, visibility === 'public' ? 0o640 : 0o600);
    return { key, ...written };
  } catch (error) {
    await unlink(temporary).catch(() => {});
    if (error.code === 'ENOSPC') throw storageError('Media storage is full. Please try again later.', 'MEDIA_STORAGE_FULL', 507);
    if (error.status) throw error;
    throw storageError('Media storage is unavailable. Please try again later.');
  }
};

/**
 * Resolve a stored file for delivery. Refuses non-files, a symlinked file, and
 * any path whose real location (after resolving symlinked parent directories)
 * leaves the storage root.
 */
export const openKey = async (key, root = rootOrThrow()) => {
  const target = resolveKey(key, root);
  const missing = () => storageError('Media not found', 'MEDIA_NOT_FOUND', 404);
  let info;
  try { info = await lstat(target); } catch { throw missing(); }
  if (!info.isFile() || info.isSymbolicLink()) throw missing();
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    const relative = path.relative(realRoot, realTarget);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('outside root');
  } catch { throw missing(); }
  return { absolutePath: target, sizeBytes: info.size, root };
};

export const readKey = async (key) => readFile((await openKey(key)).absolutePath);

export const remove = async (key) => {
  try { await unlink(resolveKey(key)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
};

/** First bytes of a stored file (for content-type checks during verification). */
export const readHead = async (key, root = rootOrThrow(), length = 1024) => {
  const handle = await open((await openKey(key, root)).absolutePath, 'r');
  try {
    const head = Buffer.alloc(length);
    const { bytesRead } = await handle.read(head, 0, length, 0);
    return head.subarray(0, bytesRead);
  } finally { await handle.close(); }
};

export const verifyKey = async (key, { sha256, sizeBytes }, root = rootOrThrow()) => {
  const { absolutePath } = await openKey(key, root);
  const actual = await hashFile(absolutePath);
  return actual.sha256 === sha256 && actual.sizeBytes === sizeBytes;
};

export const health = async () => {
  const config = getStorageConfig();
  if (!config.root) return { configured: false };
  const result = { configured: true, writable: false, freeBytes: null, minFreeBytes: config.minFreeBytes };
  try {
    await assertRootUsable(config.root);
    result.freeBytes = await freeBytes(config.root);
    const probe = path.join(config.root, 'temp', `.health-${randomUUID()}`);
    await mkdir(path.dirname(probe), { recursive: true, mode: 0o700 });
    await writeDurably(probe, { buffer: Buffer.from('ok') });
    await unlink(probe);
    result.writable = true;
  } catch { /* reported as not writable */ }
  result.belowReserve = result.freeBytes !== null && result.freeBytes < config.minFreeBytes;
  return result;
};

export const filesystemProvider = Object.freeze({ name: 'server', put, openKey, readKey, readHead, remove, verifyKey, health });
