import { mkdtemp, rm, mkdir, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { assertServerStorageConfig, getStorageConfig, MEDIA_PROJECT_ROOT, providerFor } from '../../config/storage.js';
import { categoryForFolder, isSensitiveCategory, MEDIA_CATEGORIES } from '../../services/mediaPolicy.service.js';
import { inspectMp4, sniffType, validateUpload } from '../../services/mediaValidation.service.js';
import { buildStorageKey, filesystemProvider as storage, isValidStorageKey, resolveKey } from '../../services/mediaStorage.service.js';
import { mayViewPrivate, publicUrlForKey, signedUrl, verifySignedRequest } from '../../services/mediaUrl.service.js';
import { sweepTemporaryFiles } from '../../services/mediaCleanup.service.js';

let root;
const ENV_KEYS = ['MEDIA_ROOT', 'MEDIA_SIGNING_SECRET', 'MEDIA_PUBLIC_BASE_URL', 'MEDIA_MIN_FREE_BYTES', 'MEDIA_PROVIDERS', 'MEDIA_PROVIDER_DEFAULT'];
const saved = {};

beforeAll(async () => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  root = await mkdtemp(path.join(os.tmpdir(), 'bulkimart-media-'));
});
beforeEach(() => {
  Object.assign(process.env, {
    MEDIA_ROOT: root,
    MEDIA_SIGNING_SECRET: 's'.repeat(40),
    MEDIA_PUBLIC_BASE_URL: 'https://api.example.test',
    MEDIA_MIN_FREE_BYTES: '0',
  });
  delete process.env.MEDIA_PROVIDERS;
  delete process.env.MEDIA_PROVIDER_DEFAULT;
});
afterAll(async () => {
  for (const key of ENV_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  await rm(root, { recursive: true, force: true });
});

const image = (format, { width = 40, height = 30, alpha = false } = {}) =>
  sharp({ create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 0, g: 0, b: 0, alpha: 0 } : '#c0392b' } })[format]().toBuffer();
const pdf = () => Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

// ---------------------------------------------------------------- minimal MP4 builder
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]); };
const mp4 = ({ seconds = 10, width = 1280, height = 720, codec = 'avc1', fragmented = false } = {}) => {
  const mvhd = box('mvhd', Buffer.alloc(4), u32(0), u32(0), u32(1000), u32(seconds * 1000), Buffer.alloc(80));
  const tkhd = box('tkhd', Buffer.alloc(76), u32(width * 65536), u32(height * 65536));
  const hdlr = box('hdlr', Buffer.alloc(4), u32(0), Buffer.from('vide'), Buffer.alloc(13));
  const stsd = box('stsd', Buffer.alloc(4), u32(1), box(codec, Buffer.alloc(70)));
  const trak = box('trak', tkhd, box('mdia', hdlr, box('minf', box('stbl', stsd))));
  const moov = box('moov', mvhd, trak, ...(fragmented ? [box('mvex')] : []));
  return Buffer.concat([box('ftyp', Buffer.from('isom'), u32(512), Buffer.from('isomavc1')), moov, box('mdat', Buffer.alloc(64))]);
};

describe('category policy', () => {
  test.each([
    ['avatars', 'customer.avatar'], ['landmark-images', 'customer.landmark'], ['reviews', 'customer.review'],
    ['returns', 'customer.return'], ['support-tickets', 'shared.ticket'], ['products/abc', 'seller.product'],
    ['products', 'seller.product'], ['seller-branding/u', 'seller.branding'], ['seller-kyc/u', 'seller.kyc'],
    ['seller-docs/u', 'seller.kyc'], ['seller-bank/u', 'seller.bank'], ['delivery-kyc/u', 'delivery.kyc'],
    ['delivery-bank/u', 'delivery.bank'], ['banners', 'admin.banner'], ['storefront', 'admin.storefront'],
    ['categories', 'admin.category'], ['category-icons', 'admin.category'], ['campaigns', 'admin.campaign'],
    ['notifications', 'admin.broadcast'], ['packaging-materials', 'admin.packaging'],
  ])('%s → %s', (folder, category) => expect(categoryForFolder(folder)).toBe(category));

  test('unknown or look-alike folders are not classified', () => {
    expect(categoryForFolder('productsx')).toBeNull();
    expect(categoryForFolder('../seller-kyc')).toBeNull();
    expect(categoryForFolder('')).toBeNull();
  });

  test('identity, licence and bank documents are sensitive; catalogue media is not', () => {
    for (const c of ['seller.kyc', 'seller.bank', 'delivery.kyc', 'delivery.bank']) expect(isSensitiveCategory(c)).toBe(true);
    for (const c of ['seller.product', 'admin.banner', 'customer.return']) expect(isSensitiveCategory(c)).toBe(false);
    expect(MEDIA_CATEGORIES['customer.landmark'].visibility).toBe('private');
  });
});

describe('storage configuration', () => {
  test('defaults every category to Cloudinary until switched', () => {
    expect(providerFor('seller.kyc')).toBe('cloudinary');
    process.env.MEDIA_PROVIDERS = '{"seller.kyc":"server"}';
    expect(providerFor('seller.kyc')).toBe('server');
    expect(providerFor('seller.product')).toBe('cloudinary');
  });

  test('rejects a media root inside the repository', () => {
    process.env.MEDIA_ROOT = path.join(MEDIA_PROJECT_ROOT, 'backend', 'uploads');
    expect(() => assertServerStorageConfig(getStorageConfig())).toThrow(/outside the application repository/);
  });

  test('rejects a short signing secret and a non-https public base', () => {
    process.env.MEDIA_SIGNING_SECRET = 'short';
    expect(() => assertServerStorageConfig(getStorageConfig())).toThrow(/MEDIA_SIGNING_SECRET/);
    process.env.MEDIA_SIGNING_SECRET = 's'.repeat(40);
    process.env.MEDIA_PUBLIC_BASE_URL = 'http://api.example.test';
    expect(() => assertServerStorageConfig(getStorageConfig())).toThrow(/https/);
  });

  test('rejects malformed provider maps', () => {
    process.env.MEDIA_PROVIDERS = '{"seller.kyc":"s3"}';
    expect(() => getStorageConfig()).toThrow(/MEDIA_PROVIDERS/);
  });
});

describe('content validation', () => {
  const policy = MEDIA_CATEGORIES;

  test.each(['jpeg', 'png', 'webp'])('accepts and re-encodes %s', async (format) => {
    const result = await validateUpload({ buffer: await image(format), originalName: `p.${format === 'jpeg' ? 'jpg' : format}`, declaredMime: `image/${format}` }, policy['seller.product']);
    expect(result.mimeType).toBe('image/webp');
    expect(sniffType(result.buffer)).toBe('webp');
  });

  test('KYC images are stored as JPEG with transparency flattened', async () => {
    const result = await validateUpload({ buffer: await image('png', { alpha: true }) }, policy['seller.kyc']);
    expect(result.mimeType).toBe('image/jpeg');
  });

  test('strips metadata (EXIF/GPS) from photos', async () => {
    const withExif = await sharp(await image('jpeg')).withMetadata({ exif: { IFD0: { Copyright: 'secret-location' } } }).jpeg().toBuffer();
    const result = await validateUpload({ buffer: withExif }, policy['customer.landmark']);
    expect((await sharp(result.buffer).metadata()).exif).toBeUndefined();
  });

  test('rejects PNG bytes declared as JPEG (MIME spoofing)', async () => {
    await expect(validateUpload({ buffer: await image('png'), declaredMime: 'image/jpeg' }, policy['seller.product'])).rejects.toMatchObject({ code: 'MEDIA_CONTENT_MISMATCH' });
  });

  test('rejects a double extension whose last extension disagrees with the content', async () => {
    await expect(validateUpload({ buffer: await image('png'), originalName: 'photo.png.php' }, policy['seller.product'])).rejects.toMatchObject({ code: 'MEDIA_CONTENT_MISMATCH' });
  });

  test('rejects executables and HTML even when named like images', async () => {
    await expect(validateUpload({ buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]), originalName: 'a.jpg', declaredMime: 'image/jpeg' }, policy['seller.product'])).rejects.toMatchObject({ code: 'MEDIA_TYPE_NOT_ALLOWED' });
    await expect(validateUpload({ buffer: Buffer.from('<html><script>alert(1)</script></html>'), originalName: 'a.png' }, policy['customer.avatar'])).rejects.toMatchObject({ code: 'MEDIA_TYPE_NOT_ALLOWED' });
  });

  test('rejects a corrupt image with a valid signature', async () => {
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 7)]);
    await expect(validateUpload({ buffer: corrupt }, policy['seller.product'])).rejects.toMatchObject({ code: 'MEDIA_INVALID' });
  });

  test('enforces the size limit', async () => {
    await expect(validateUpload({ buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 1) }, policy['seller.product'])).rejects.toMatchObject({ status: 413, code: 'MEDIA_TOO_LARGE' });
  });

  test('PDF: accepted where allowed, rejected where not, truncated rejected', async () => {
    await expect(validateUpload({ buffer: pdf(), originalName: 'pan.pdf', declaredMime: 'application/pdf' }, policy['seller.kyc'])).resolves.toMatchObject({ mimeType: 'application/pdf' });
    await expect(validateUpload({ buffer: pdf() }, policy['seller.product'])).rejects.toMatchObject({ code: 'MEDIA_TYPE_NOT_ALLOWED' });
    await expect(validateUpload({ buffer: Buffer.from('%PDF-1.4 truncated') }, policy['seller.kyc'])).rejects.toMatchObject({ code: 'MEDIA_INVALID' });
  });

  test('SVG: unsafe content rejected, safe icon rasterised to transparent PNG', async () => {
    const unsafe = [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
    ];
    for (const svg of unsafe) {
      await expect(validateUpload({ buffer: Buffer.from(svg) }, policy['admin.category'])).rejects.toMatchObject({ status: 400 });
    }
    const safe = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#0a0"/></svg>';
    const result = await validateUpload({ buffer: Buffer.from(safe), originalName: 'icon.svg', declaredMime: 'image/svg+xml' }, policy['admin.category']);
    expect(result.mimeType).toBe('image/png');
    const meta = await sharp(result.buffer).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(512);
  });

  test('SVG is not accepted for avatars', async () => {
    await expect(validateUpload({ buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }, policy['customer.avatar'])).rejects.toMatchObject({ code: 'MEDIA_TYPE_NOT_ALLOWED' });
  });
});

describe('storefront video validation (no transcoding)', () => {
  const policy = MEDIA_CATEGORIES['admin.storefront'];
  const reader = (buffer) => ({ size: buffer.length, read: async (o, l) => buffer.subarray(o, o + l) });

  test('reads duration, codec and dimensions from the MP4 header', async () => {
    await expect(inspectMp4(reader(mp4({ seconds: 12, width: 1280, height: 720 })))).resolves.toEqual({ durationSec: 12, codec: 'avc1', width: 1280, height: 720 });
  });

  test('accepts a compliant H.264 clip', async () => {
    await expect(validateUpload({ buffer: mp4(), originalName: 'hero.mp4', declaredMime: 'video/mp4' }, policy)).resolves.toMatchObject({ mimeType: 'video/mp4', durationSec: 10, width: 1280 });
  });

  test.each([
    [{ seconds: 16 }, /15 seconds/],
    [{ width: 1920, height: 1080 }, /1280 px/],
    [{ codec: 'hvc1' }, /H\.264/],
    [{ fragmented: true }, /Fragmented/],
  ])('rejects %o', async (options, message) => {
    await expect(validateUpload({ buffer: mp4(options) }, policy)).rejects.toMatchObject({ code: 'MEDIA_VIDEO_UNSUPPORTED', message: expect.stringMatching(message) });
  });

  test('a truncated MP4 is reported as malformed (400), not a server error', async () => {
    const full = mp4();
    await expect(validateUpload({ buffer: full.subarray(0, 60) }, policy)).rejects.toMatchObject({ status: 400 });
  });

  test('rejects WebM with a clear message', async () => {
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100)]);
    await expect(validateUpload({ buffer: webm, originalName: 'a.webm' }, policy)).rejects.toMatchObject({ message: expect.stringMatching(/MP4 \(H\.264\)/) });
  });

  test('validates video from a temp file path without reading it whole', async () => {
    const file = path.join(root, 'clip.mp4');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, mp4());
    await expect(validateUpload({ filePath: file, size: mp4().length }, policy)).resolves.toMatchObject({ filePath: file, durationSec: 10 });
  });
});

describe('filesystem storage', () => {
  test('stores, verifies, opens and removes a file atomically', async () => {
    const key = buildStorageKey({ area: 'private', dir: 'seller-documents', ext: 'pdf' });
    const stored = await storage.put({ key, source: { buffer: pdf() }, visibility: 'private-kyc' });
    expect(stored.sizeBytes).toBe(pdf().length);
    expect(await storage.verifyKey(key, stored)).toBe(true);
    expect(await readFile((await storage.openKey(key)).absolutePath)).toEqual(pdf());
    expect(await readdir(path.join(root, 'temp'))).toEqual([]);
    await storage.remove(key);
    await expect(storage.openKey(key)).rejects.toMatchObject({ status: 404 });
  });

  test.each(['../etc/passwd', 'public/../../x.jpg', '/etc/passwd', 'public/products/2026/01/not-a-uuid.jpg', 'public/products/2026/01/%2e%2e.jpg'])('rejects unsafe key %s', (key) => {
    expect(isValidStorageKey(key)).toBe(false);
    expect(() => resolveKey(key)).toThrow();
  });

  test('refuses writes below the free-space reserve without leaving partial files', async () => {
    process.env.MEDIA_MIN_FREE_BYTES = String(Number.MAX_SAFE_INTEGER);
    const key = buildStorageKey({ area: 'public', dir: 'products', ext: 'webp' });
    await expect(storage.put({ key, source: { buffer: Buffer.from('x') }, visibility: 'public' })).rejects.toMatchObject({ status: 507, code: 'MEDIA_STORAGE_FULL' });
    await expect(storage.openKey(key)).rejects.toMatchObject({ status: 404 });
  });

  test('fails clearly when the storage root is missing (unmounted volume)', async () => {
    process.env.MEDIA_ROOT = path.join(root, 'does-not-exist');
    const key = buildStorageKey({ area: 'public', dir: 'products', ext: 'webp' });
    await expect(storage.put({ key, source: { buffer: Buffer.from('x') }, visibility: 'public' })).rejects.toMatchObject({ status: 503, code: 'MEDIA_STORAGE_UNAVAILABLE' });
  });

  test('rejects a write whose content does not match the expected checksum', async () => {
    const key = buildStorageKey({ area: 'public', dir: 'products', ext: 'webp' });
    await expect(storage.put({ key, source: { buffer: Buffer.from('abc') }, visibility: 'public', expected: { sha256: '0'.repeat(64), sizeBytes: 3 } })).rejects.toMatchObject({ status: 503 });
    await expect(storage.openKey(key)).rejects.toMatchObject({ status: 404 });
  });

  test('sweeps abandoned temporary files older than a day', async () => {
    await mkdir(path.join(root, 'temp'), { recursive: true });
    const { writeFile, utimes } = await import('node:fs/promises');
    const stale = path.join(root, 'temp', 'old.partial');
    await writeFile(stale, 'x');
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await utimes(stale, twoDaysAgo, twoDaysAgo);
    await writeFile(path.join(root, 'temp', 'fresh.partial'), 'x');
    expect(await sweepTemporaryFiles()).toBe(1);
    expect(await readdir(path.join(root, 'temp'))).toEqual(['fresh.partial']);
  });
});

describe('URLs and signed access', () => {
  const id = 'a'.repeat(24), viewer = 'b'.repeat(24);
  const params = (url) => { const u = new URL(url); return { mediaId: u.pathname.split('/').pop(), e: u.searchParams.get('e'), v: u.searchParams.get('v'), s: u.searchParams.get('s') }; };

  test('public keys map to stable public URLs; private keys never do', () => {
    expect(publicUrlForKey('public/products/2026/11/x.webp')).toBe('https://api.example.test/media/products/2026/11/x.webp');
    expect(() => publicUrlForKey('private/seller-documents/2026/11/x.pdf')).toThrow();
  });

  test('a fresh signature verifies', () => {
    expect(verifySignedRequest(params(signedUrl(id, viewer)))).toBe(true);
  });

  test('expired, tampered and re-targeted signatures are rejected', () => {
    const p = params(signedUrl(id, viewer, Date.now() - 2 * 60 * 60 * 1000));
    expect(verifySignedRequest(p)).toBe(false);
    const fresh = params(signedUrl(id, viewer));
    expect(verifySignedRequest({ ...fresh, s: `${fresh.s.slice(0, -1)}A` })).toBe(false);
    expect(verifySignedRequest({ ...fresh, v: 'c'.repeat(24) })).toBe(false);
    expect(verifySignedRequest({ ...fresh, mediaId: 'd'.repeat(24) })).toBe(false);
    expect(verifySignedRequest({ ...fresh, e: String(Number(fresh.e) + 60) })).toBe(false);
  });

  test('KYC documents: only admins and the owner may receive a signed link', () => {
    const kyc = { visibility: 'private-kyc', ownerId: viewer };
    expect(mayViewPrivate(kyc, { id: viewer, isAdmin: false })).toBe(true);
    expect(mayViewPrivate(kyc, { id: 'c'.repeat(24), isAdmin: false })).toBe(false);
    expect(mayViewPrivate(kyc, { id: 'c'.repeat(24), isAdmin: true })).toBe(true);
    expect(mayViewPrivate(kyc, null)).toBe(false);
    expect(mayViewPrivate({ visibility: 'private' }, null)).toBe(false);
  });
});
