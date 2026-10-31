import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getStorageConfig } from '../config/storage.js';
import { health } from './mediaStorage.service.js';

// Background housekeeping for server media storage:
//  - removes abandoned temporary files (interrupted uploads, crashed writes)
//  - logs a warning when free space drops below the configured reserve
// Orphan detection (stored files no record references) is a reviewed,
// report-first script: backend/scripts/media/orphans.mjs.

const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;

export const sweepTemporaryFiles = async (now = Date.now()) => {
  const { root } = getStorageConfig();
  if (!root) return 0;
  const tempDir = path.join(root, 'temp');
  let removed = 0;
  let entries;
  try { entries = await readdir(tempDir, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(tempDir, entry.name);
    try {
      if (now - (await stat(file)).mtimeMs > TEMP_MAX_AGE_MS) { await unlink(file); removed += 1; }
    } catch { /* already gone */ }
  }
  return removed;
};

const tick = async () => {
  try {
    const removed = await sweepTemporaryFiles();
    if (removed) console.log(`[MEDIA] removed ${removed} abandoned temporary upload file(s).`);
    const disk = await health();
    if (disk.configured && (!disk.writable || disk.belowReserve)) {
      console.warn(`[MEDIA] storage ${!disk.writable ? 'is not writable' : 'is below the free-space reserve'}; uploads will be refused.`);
    }
  } catch (error) {
    console.warn(`[MEDIA] maintenance failed: ${error.message}`);
  }
};

export const startMediaMaintenance = () => {
  if (!getStorageConfig().root) return null;
  void tick();
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
  return timer;
};
