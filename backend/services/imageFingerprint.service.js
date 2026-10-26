import sharp from 'sharp';
import path from 'node:path';
import { httpError } from '../utils/response.js';
export const IMAGE_INDEX_VERSION = 1;
export const IMAGE_SEARCH_MODE = 'visual-fingerprint-v2';
export const imageSearchEnabled = () => true;
export function imageSearchMaxBytes() {
  const value = Number(process.env.IMAGE_SEARCH_MAX_BYTES || 5 * 1024 * 1024);
  if (!Number.isSafeInteger(value) || value < 1024 || value > 10 * 1024 * 1024) throw httpError(503, 'Image search upload configuration is invalid.');
  return value;
}
const mime = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
export async function fingerprintImage(buffer, file) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw httpError(400, 'Choose a JPG, PNG or WEBP image.');
  if (buffer.length > imageSearchMaxBytes()) throw httpError(413, 'Image exceeds the image search upload limit.');
  const rasterSignature = (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    || buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP');
  if (!rasterSignature) throw httpError(400, 'Choose a valid JPG, PNG or WEBP image.');
  try {
    const image = sharp(buffer, { failOn: 'warning', limitInputPixels: 20000000, sequentialRead: true });
    const metadata = await image.metadata();
    if (!mime[metadata.format] || (metadata.pages || 1) !== 1) throw new Error('Unsupported format');
    if (file) {
      const extensions = metadata.format === 'jpeg' ? ['.jpg', '.jpeg'] : [`.${metadata.format}`];
      if (file.mimetype !== mime[metadata.format] || !extensions.includes(path.extname(file.originalname || '').toLowerCase())) throw new Error('Format mismatch');
    }
    // Full raster decoding, EXIF orientation, white alpha background, no EXIF retention.
    const normalized = await image.timeout({ seconds: 5 }).rotate().flatten({ background: '#fff' }).toColourspace('srgb').resize(32, 32, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const gray = await sharp(normalized, { raw: { width: 32, height: 32, channels: 3 } }).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
    let hash = '';
    for (let y = 0; y < 8; y++) {
      let byte = 0;
      for (let x = 0; x < 8; x++) byte = (byte << 1) | (gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1 : 0);
      hash += byte.toString(16).padStart(2, '0');
    }
    const histogram = Array(24).fill(0);
    for (let i = 0; i < normalized.length; i++) histogram[(i % 3) * 8 + Math.min(7, normalized[i] >> 5)] += 1 / 1024;
    const spatial = Array.from(await sharp(normalized, { raw: { width: 32, height: 32, channels: 3 } }).resize(8, 8, { fit: 'fill' }).raw().toBuffer(), v => v / 255);
    const colorHistogram = foregroundColors(Array.from(normalized, v => v / 255));
    return { version: IMAGE_INDEX_VERSION, hash, bands: Array.from({ length: 8 }, (_, i) => `d${i}:${hash.slice(i * 2, i * 2 + 2)}`), histogram, spatial,
      colorHistogram, colorBands: colorBands(colorHistogram) };
  } catch (error) {
    if (error.status) throw error;
    throw httpError(400, 'Image cannot be decoded. Use a non-animated JPG, PNG or WEBP under 20 megapixels.');
  }
}
// Hue ignores brightness changes. Saturated pixels describe packaging without
// letting a shared white studio background outweigh the actual product colour.
// Legacy index rows can derive the same descriptor from their stored RGB grid.
function foregroundColors(rgb) {
  const colors = Array(15).fill(0);
  let colored = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    const [r, g, b] = rgb.slice(i, i + 3), max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    if (max > 0.15 && delta / max >= 0.25) {
      let hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      hue = ((hue / 6) + 1) % 1;
      // Interpolate circular bins so two nearby reds across 0/360 stay similar.
      const position = hue * 12, bin = Math.floor(position), fraction = position - bin;
      colors[bin] += 1 - fraction; colors[(bin + 1) % 12] += fraction; colored++;
    } else colors[max < 0.25 ? 12 : max < 0.8 ? 13 : 14]++;
  }
  const hasColor = colored >= rgb.length / 3 * 0.06;
  const total = hasColor ? colored : rgb.length / 3 - colored;
  return colors.map((value, i) => (hasColor ? i < 12 : i >= 12) ? value / total : 0);
}
function colorBands(histogram) {
  const bands = new Set();
  histogram.forEach((weight, i) => {
    if (weight < 0.15) return;
    bands.add(`c${i}`);
    if (i < 12) { bands.add(`c${(i + 11) % 12}`); bands.add(`c${(i + 1) % 12}`); }
  });
  return [...bands];
}
export function imageColorBands(fingerprint) {
  return fingerprint.colorBands?.length ? fingerprint.colorBands : colorBands(foregroundColors(fingerprint.spatial));
}
export function imageSimilarity(a, b) {
  let bits = BigInt(`0x${a.hash}`) ^ BigInt(`0x${b.hash}`), hamming = 0;
  while (bits) { hamming += Number(bits & 1n); bits >>= 1n; }
  const spatial = a.spatial.reduce((sum, v, i) => sum + Math.abs(v - b.spatial[i]), 0) / a.spatial.length;
  const color = a.histogram.reduce((sum, v, i) => sum + Math.abs(v - b.histogram[i]), 0) / 6;
  const foregroundA = a.colorHistogram?.length ? a.colorHistogram : foregroundColors(a.spatial);
  const foregroundB = b.colorHistogram?.length ? b.colorHistogram : foregroundColors(b.spatial);
  const overlap = Math.max(0, 1 - foregroundA.reduce((sum, v, i) => sum + Math.abs(v - foregroundB[i]), 0) / 2);
  // Similar outlines/white backgrounds alone must not match a blue or green pack
  // to a red upload. Layout still contributes to ranking within a colour family.
  if (overlap < 0.6) return 0;
  return Math.max(0, 1 - (0.55 * (1 - overlap) + 0.2 * hamming / 64 + 0.15 * spatial + 0.1 * color));
}
