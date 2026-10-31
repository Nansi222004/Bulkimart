import { open } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Content-based validation for every server-stored upload. The file's bytes
// decide its type; the client's filename and declared MIME type must agree
// with them but are never trusted on their own. Accepted images are decoded
// and re-encoded, which drops embedded payloads and metadata (EXIF/GPS).

const invalid = (message, code = 'MEDIA_INVALID', status = 400) => Object.assign(new Error(message), { status, code });

const EXTENSIONS = {
  jpeg: ['.jpg', '.jpeg'], png: ['.png'], webp: ['.webp'], pdf: ['.pdf'], svg: ['.svg'], mp4: ['.mp4', '.m4v'],
};
const MIME_TYPES = {
  jpeg: ['image/jpeg', 'image/jpg', 'image/pjpeg'], png: ['image/png'], webp: ['image/webp'],
  pdf: ['application/pdf', 'application/x-pdf'], svg: ['image/svg+xml'], mp4: ['video/mp4'],
};
// Phones and some pickers label files generically; content still decides.
const GENERIC_MIME = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

export const VIDEO_LIMITS = Object.freeze({ maxDurationSec: 15, durationToleranceSec: 0.5, maxWidth: 1280, codecs: ['avc1', 'avc3'] });
const IMAGE_PIXEL_LIMIT = 40_000_000;

/** Identify a file from its leading bytes. Returns null for anything unsupported. */
export const sniffType = (head) => {
  if (!Buffer.isBuffer(head) || head.length < 4) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (head.length >= 8 && head.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (head.subarray(0, 1024).includes(Buffer.from('%PDF-'))) return 'pdf';
  if (head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  const text = head.toString('utf8', 0, Math.min(head.length, 1024)).replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) return 'svg';
  return null;
};

const assertNameAndMimeAgree = (type, { originalName, declaredMime }) => {
  if (originalName) {
    const ext = path.extname(String(originalName)).toLowerCase();
    if (ext && !EXTENSIONS[type]?.includes(ext)) throw invalid('The file extension does not match its contents.', 'MEDIA_CONTENT_MISMATCH');
  }
  const mime = String(declaredMime || '').toLowerCase();
  if (!GENERIC_MIME.has(mime) && !MIME_TYPES[type]?.includes(mime)) {
    throw invalid('The declared file type does not match its contents.', 'MEDIA_CONTENT_MISMATCH');
  }
};

// ---------------------------------------------------------------- SVG

/** Reject SVG features that can run script or pull in external resources. */
export const assertSafeSvg = (text) => {
  const unsafe = [
    /<script\b/i, /<foreignObject\b/i, /<!ENTITY/i, /<!DOCTYPE/i, /<iframe\b/i, /<embed\b/i, /<object\b/i,
    /\son[a-z]+\s*=/i, /javascript\s*:/i, /data\s*:\s*text\/html/i,
    /(?:xlink:)?href\s*=\s*["']\s*(?!#)/i, /\bsrc\s*=/i, /url\(\s*["']?\s*(?!#)/i, /@import/i,
  ];
  if (unsafe.some((pattern) => pattern.test(text))) {
    throw invalid('SVG icons may not contain scripts, event handlers or external references.', 'MEDIA_SVG_UNSAFE');
  }
};

// ---------------------------------------------------------------- images

const encode = (pipeline, output) => {
  if (output === 'jpeg') return pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true });
  if (output === 'png') return pipeline.png({ compressionLevel: 9 });
  return pipeline.webp({ quality: 82 });
};

const processImage = async (input, policy, { output, svg = false } = {}) => {
  let result;
  try {
    const image = sharp(input, { limitInputPixels: IMAGE_PIXEL_LIMIT, failOn: 'error', ...(svg ? { density: 144 } : {}) });
    const meta = await image.metadata();
    if (!meta.width || !meta.height) throw new Error('no dimensions');
    // SVG icons are vector: render them at a fixed icon-friendly size instead of their nominal viewBox size.
    const side = svg ? Math.min(policy.maxSide, 512) : policy.maxSide;
    const pipeline = image.rotate().resize({ width: side, height: side, fit: 'inside', withoutEnlargement: !svg });
    result = await encode(pipeline, output).toBuffer({ resolveWithObject: true });
  } catch {
    throw invalid('The image could not be read. Upload a valid JPEG, PNG or WebP image.');
  }
  const ext = output === 'jpeg' ? 'jpg' : output;
  return { buffer: result.data, mimeType: `image/${output}`, ext, width: result.info.width, height: result.info.height };
};

// ---------------------------------------------------------------- PDF

const assertPdf = (buffer) => {
  if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw invalid('The uploaded file is not a valid PDF.');
  if (!buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from('%%EOF'))) {
    throw invalid('The uploaded PDF is incomplete or malformed.');
  }
};

// ---------------------------------------------------------------- MP4

const bufferReader = (buffer) => ({ size: buffer.length, read: async (offset, length) => buffer.subarray(offset, offset + length) });

const fileReader = async (filePath) => {
  const handle = await open(filePath, 'r');
  const { size } = await handle.stat();
  return {
    size,
    read: async (offset, length) => {
      const target = Buffer.alloc(Math.max(0, Math.min(length, size - offset)));
      if (target.length) await handle.read(target, 0, target.length, offset);
      return target;
    },
    close: () => handle.close(),
  };
};

const boxHeader = (header, offset, end) => {
  if (header.length < 8) return null;
  let size = header.readUInt32BE(0);
  const type = header.toString('latin1', 4, 8);
  let headerSize = 8;
  if (size === 1) {
    if (header.length < 16) return null;
    size = Number(header.readBigUInt64BE(8));
    headerSize = 16;
  } else if (size === 0) {
    size = end - offset;
  }
  if (size < headerSize || offset + size > end) return null;
  return { type, size, headerSize, start: offset, end: offset + size };
};

/** Child boxes of an in-memory container, as [{type, start, end, headerSize}]. */
const children = (buf, start, end) => {
  const boxes = [];
  for (let offset = start; offset + 8 <= end;) {
    const box = boxHeader(buf.subarray(offset, offset + 16), offset, end);
    if (!box) break;
    boxes.push(box);
    offset = box.end;
  }
  return boxes;
};
const child = (buf, parent, type) => children(buf, parent.start + parent.headerSize, parent.end).find((b) => b.type === type);

/** Reads duration, codec and dimensions from an MP4 container without decoding it. */
export const inspectMp4 = async (reader) => {
  let moov = null;
  let first = true;
  for (let offset = 0; offset + 8 <= reader.size;) {
    const box = boxHeader(await reader.read(offset, 16), offset, reader.size);
    if (!box) throw invalid('The video file is malformed.');
    if (first && box.type !== 'ftyp') throw invalid('The video is not a valid MP4 file.');
    first = false;
    if (box.type === 'moov') { moov = box; break; }
    offset = box.end;
  }
  if (!moov) throw invalid('The video is missing its MP4 index (moov box).');
  if (moov.size > 16 * 1024 * 1024) throw invalid('The video index is too large.');
  const buf = await reader.read(moov.start, moov.size);
  const root = { start: 0, end: buf.length, headerSize: moov.headerSize };

  if (child(buf, root, 'mvex')) throw invalid('Fragmented MP4 is not supported. Export a standard MP4 (H.264).', 'MEDIA_VIDEO_UNSUPPORTED');
  const mvhd = child(buf, root, 'mvhd');
  if (!mvhd) throw invalid('The video is missing its duration header.');
  const v1 = buf[mvhd.start + 8] === 1;
  const timescale = buf.readUInt32BE(mvhd.start + (v1 ? 28 : 20));
  const duration = v1 ? Number(buf.readBigUInt64BE(mvhd.start + 32)) : buf.readUInt32BE(mvhd.start + 24);
  if (!timescale || !duration) throw invalid('The video duration could not be read.', 'MEDIA_VIDEO_UNSUPPORTED');

  let video = null;
  for (const trak of children(buf, root.headerSize, root.end).filter((b) => b.type === 'trak')) {
    const mdia = child(buf, trak, 'mdia');
    const hdlr = mdia && child(buf, mdia, 'hdlr');
    if (!hdlr || buf.toString('latin1', hdlr.start + 16, hdlr.start + 20) !== 'vide') continue;
    const tkhd = child(buf, trak, 'tkhd');
    const stsd = child(buf, child(buf, child(buf, mdia, 'minf') || mdia, 'stbl') || mdia, 'stsd');
    if (!tkhd || !stsd) continue;
    const tv1 = buf[tkhd.start + 8] === 1;
    const dims = tkhd.start + (tv1 ? 96 : 84);
    video = {
      codec: buf.toString('latin1', stsd.start + 20, stsd.start + 24),
      width: Math.round(buf.readUInt32BE(dims) / 65536),
      height: Math.round(buf.readUInt32BE(dims + 4) / 65536),
    };
    break;
  }
  if (!video) throw invalid('The MP4 file has no video track.', 'MEDIA_VIDEO_UNSUPPORTED');
  return { durationSec: duration / timescale, ...video };
};

export const assertVideoWithinLimits = (info) => {
  if (!VIDEO_LIMITS.codecs.includes(info.codec)) {
    throw invalid('Videos must be encoded as H.264 MP4. Re-export the clip as MP4 (H.264) and upload again.', 'MEDIA_VIDEO_UNSUPPORTED');
  }
  if (info.durationSec > VIDEO_LIMITS.maxDurationSec + VIDEO_LIMITS.durationToleranceSec) {
    throw invalid(`Videos must be ${VIDEO_LIMITS.maxDurationSec} seconds or shorter.`, 'MEDIA_VIDEO_UNSUPPORTED');
  }
  if (!info.width || info.width > VIDEO_LIMITS.maxWidth) {
    throw invalid(`Videos must be at most ${VIDEO_LIMITS.maxWidth} px wide.`, 'MEDIA_VIDEO_UNSUPPORTED');
  }
};

// ---------------------------------------------------------------- entry point

/**
 * Validate and normalise one upload for a category policy.
 * input: { buffer } or { filePath, size } (file path only for MP4), plus
 *        optional originalName / declaredMime from the client, and
 *        options.output to force an image output format (e.g. 'png' icons).
 * Returns { buffer | filePath, mimeType, ext, sizeBytes, width?, height?, durationSec? }.
 */
export const validateUpload = async (input, policy, options = {}) => {
  const size = input.buffer ? input.buffer.length : Number(input.size || 0);
  if (!size) throw invalid('The uploaded file is empty.');
  if (size > policy.maxBytes) {
    throw invalid(`The file exceeds the ${Math.round(policy.maxBytes / (1024 * 1024))} MB limit.`, 'MEDIA_TOO_LARGE', 413);
  }

  const reader = input.buffer ? bufferReader(input.buffer) : await fileReader(input.filePath);
  try {
    const type = sniffType(await reader.read(0, 1024));
    if (type === 'webm' && policy.accept.includes('mp4')) {
      throw invalid('WebM is not supported. Upload the video as MP4 (H.264).', 'MEDIA_VIDEO_UNSUPPORTED');
    }
    if (!type || !policy.accept.includes(type)) throw invalid('This file type is not allowed here.', 'MEDIA_TYPE_NOT_ALLOWED');
    assertNameAndMimeAgree(type, input);

    if (type === 'mp4') {
      // Truncated boxes can make header reads run past the data: report as malformed, not a 500.
      const info = await inspectMp4(reader).catch((error) => { throw error.status ? error : invalid('The video file is malformed.'); });
      assertVideoWithinLimits(info);
      return { ...(input.buffer ? { buffer: input.buffer } : { filePath: input.filePath }), mimeType: 'video/mp4', ext: 'mp4', sizeBytes: size, width: info.width, height: info.height, durationSec: info.durationSec };
    }
    const buffer = input.buffer || await reader.read(0, size);
    if (type === 'pdf') {
      assertPdf(buffer);
      return { buffer, mimeType: 'application/pdf', ext: 'pdf', sizeBytes: buffer.length };
    }
    if (type === 'svg') {
      assertSafeSvg(buffer.toString('utf8'));
      const image = await processImage(buffer, policy, { output: 'png', svg: true });
      return { ...image, sizeBytes: image.buffer.length };
    }
    const image = await processImage(buffer, policy, { output: options.output || policy.output });
    return { ...image, sizeBytes: image.buffer.length };
  } finally {
    await reader.close?.();
  }
};
