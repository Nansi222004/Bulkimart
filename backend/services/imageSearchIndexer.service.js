import Product from '../models/Product.js';
import Index from '../models/ProductImageIndex.js';
import Job from '../models/ProductImageIndexJob.js';
import { fingerprintImage, imageSearchEnabled, imageSearchMaxBytes } from './imageFingerprint.service.js';

export async function enqueueImageSearchIndex(productId) {
  if (!imageSearchEnabled()) return;
  await Job.updateOne({ productId }, { $inc: { revision: 1 }, $set: { attempts: 0, nextAttemptAt: new Date() }, $setOnInsert: { lockedUntil: new Date(0) } }, { upsert: true });
}
export function allowedCatalogImageUrl(value) {
  let url; try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  // Only administrator-configured HTTPS CDN origins. No redirects or arbitrary
  // URL fetches from a customer upload or untrusted host supplied by a seller.
  const allowed = ['https://res.cloudinary.com', ...(process.env.IMAGE_SEARCH_CATALOG_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean)];
  return allowed.includes(url.origin);
}
export async function downloadCatalogImage(url) {
  if (!allowedCatalogImageUrl(url)) throw new Error('Unsupported catalogue image origin');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok || !/^image\/(jpeg|png|webp)(;|$)/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw new Error('Catalogue image unavailable'); }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > imageSearchMaxBytes()) throw new Error('Catalogue image exceeds limit'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
export async function syncProductImageIndex(productId, download = downloadCatalogImage) {
  const product = await Product.findById(productId).select('images isDeleted').lean();
  if (!product || product.isDeleted) { await Index.deleteMany({ productId }); return; }
  const urls = [...new Set(product.images || [])];
  let failed = false;
  for (const imageUrl of urls) {
    try {
      const fingerprint = await fingerprintImage(await download(imageUrl));
      await Index.updateOne({ productId, imageUrl }, { $set: fingerprint }, { upsert: true });
    } catch { failed = true; }
  }
  await Index.deleteMany({ productId, imageUrl: { $nin: urls } });
  if (failed) throw new Error('Some catalogue images could not be indexed');
}
export async function processImageIndexJob() {
  const now = new Date();
  const job = await Job.findOneAndUpdate({ attempts: { $lt: 5 }, lockedUntil: { $lte: now }, nextAttemptAt: { $lte: now } }, { $set: { lockedUntil: new Date(Date.now() + 120000) } }, { returnDocument: 'after', sort: { nextAttemptAt: 1 } });
  if (!job) return false;
  try {
    await syncProductImageIndex(job.productId);
    await Job.deleteOne({ _id: job._id, revision: job.revision });
    await Job.updateOne({ _id: job._id }, { $set: { lockedUntil: new Date(0) } });
  } catch {
    // No image URL, credentials, image bytes or vendor metadata in logs.
    await Job.updateOne({ _id: job._id, revision: job.revision }, { $inc: { attempts: 1 }, $set: { lockedUntil: new Date(0), nextAttemptAt: new Date(Date.now() + 60000 * (job.attempts + 1)) } });
    await Job.updateOne({ _id: job._id, revision: { $ne: job.revision } }, { $set: { lockedUntil: new Date(0) } });
  }
  return true;
}
let timer, running = false;
export function startImageSearchIndexer() {
  if (!imageSearchEnabled() || timer) return;
  timer = setInterval(async () => {
    if (running) return; running = true;
    try { await processImageIndexJob(); } catch { console.warn('[IMAGE SEARCH] Index worker unavailable; queued jobs retained.'); }
    finally { running = false; }
  }, 2000);
  timer.unref();
}
