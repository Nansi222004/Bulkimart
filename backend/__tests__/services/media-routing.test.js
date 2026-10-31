import { jest } from '@jest/globals';

// Cloudinary SDK, the central media service and the Media model are mocked:
// these tests cover routing and response resolution, not storage or the DB.
const uploadStream = jest.fn((options, callback) => ({ end: jest.fn(() => callback(null, { secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/nhcone/x.jpg', public_id: 'nhcone/x', resource_type: 'image', bytes: 3, format: 'jpg' })) }));
jest.unstable_mockModule('cloudinary', () => ({ v2: { config: jest.fn(), api: { ping: jest.fn() }, uploader: { upload_stream: uploadStream, destroy: jest.fn() } } }));

const storeUpload = jest.fn();
jest.unstable_mockModule('../../services/media.service.js', () => ({ storeUpload, mediaContext: jest.fn(), removeByReference: jest.fn(), keyFromPublicUrl: jest.fn() }));

let mediaRows = [];
const find = jest.fn(() => ({ select: () => ({ lean: async () => mediaRows }) }));
jest.unstable_mockModule('../../models/Media.js', () => ({ default: { find } }));

process.env.CLOUDINARY_CLOUD_NAME = 'demo';
process.env.CLOUDINARY_API_KEY = 'key';
process.env.CLOUDINARY_API_SECRET = 'secret';

const { uploadToCloudinary, uploadFileWithMeta, isSensitiveFolder } = await import('../../services/cloudinary.service.js');
const { resolveResponseText, clearMediaUrlCache, verifySignedRequest, normalizeMediaInput, signedUrl } = await import('../../services/mediaUrl.service.js');

const OWNER = 'b'.repeat(24);
const OTHER = 'c'.repeat(24);
const KYC_ID = 'a'.repeat(24);
const RETURN_ID = 'd'.repeat(24);

beforeEach(() => {
  jest.clearAllMocks();
  clearMediaUrlCache();
  Object.assign(process.env, { MEDIA_ROOT: '/var/lib/bulkimart-test-media', MEDIA_SIGNING_SECRET: 's'.repeat(40), MEDIA_PUBLIC_BASE_URL: 'https://api.example.test' });
  delete process.env.MEDIA_PROVIDERS;
  delete process.env.MEDIA_PROVIDER_DEFAULT;
  delete process.env.MEDIA_LEGACY_READ_MAP;
  mediaRows = [];
});

describe('upload routing', () => {
  test('categories default to Cloudinary (no behaviour change on deploy)', async () => {
    await expect(uploadToCloudinary(Buffer.from('img'), 'seller-kyc/u1', { owner: { id: OWNER, role: 'seller' } })).resolves.toMatch(/^https:\/\/res\.cloudinary\.com\//);
    expect(storeUpload).not.toHaveBeenCalled();
    // Server-only options are never forwarded to Cloudinary.
    expect(uploadStream.mock.calls[0][0]).not.toHaveProperty('owner');
  });

  test('a category switched to server storage never touches Cloudinary', async () => {
    process.env.MEDIA_PROVIDERS = '{"seller.kyc":"server"}';
    storeUpload.mockResolvedValue({ media: { _id: KYC_ID }, reference: `media:${KYC_ID}` });
    const owner = { id: OWNER, role: 'seller' };
    await expect(uploadToCloudinary(Buffer.from('img'), 'seller-docs/u1', { owner, originalName: 'pan.pdf', declaredMime: 'application/pdf' })).resolves.toBe(`media:${KYC_ID}`);
    expect(storeUpload).toHaveBeenCalledWith(expect.objectContaining({ category: 'seller.kyc', owner, originalName: 'pan.pdf', declaredMime: 'application/pdf' }));
    expect(uploadStream).not.toHaveBeenCalled();
  });

  test('server storage failure is reported, with no fallback to Cloudinary or local disk', async () => {
    process.env.MEDIA_PROVIDER_DEFAULT = 'server';
    storeUpload.mockRejectedValue(Object.assign(new Error('Media storage is unavailable.'), { status: 503 }));
    await expect(uploadToCloudinary(Buffer.from('img'), 'products/s1')).rejects.toMatchObject({ status: 503 });
    expect(uploadStream).not.toHaveBeenCalled();
  });

  test('category icons keep PNG output on the server', async () => {
    process.env.MEDIA_PROVIDER_DEFAULT = 'server';
    storeUpload.mockResolvedValue({ media: {}, reference: 'https://api.example.test/media/categories/2026/11/x.png' });
    await uploadToCloudinary(Buffer.from('<svg/>'), 'category-icons', { resource_type: 'image', format: 'png' });
    expect(storeUpload).toHaveBeenCalledWith(expect.objectContaining({ category: 'admin.category', output: 'png' }));
  });

  test('attachment metadata keeps its shape for server-stored files', async () => {
    process.env.MEDIA_PROVIDERS = '{"shared.ticket":"server"}';
    storeUpload.mockResolvedValue({ media: { _id: RETURN_ID, mimeType: 'application/pdf', sizeBytes: 10, extension: 'pdf' }, reference: `media:${RETURN_ID}` });
    await expect(uploadFileWithMeta(Buffer.from('%PDF'), 'support-tickets', { resource_type: 'raw' })).resolves.toEqual({ url: `media:${RETURN_ID}`, publicId: RETURN_ID, resourceType: 'raw', size: 10, format: 'pdf' });
  });

  test('PAN/trade licence and rider bank folders are sensitive', () => {
    expect(isSensitiveFolder('seller-docs/u1')).toBe(true);
    expect(isSensitiveFolder('delivery-bank/u1')).toBe(true);
    expect(isSensitiveFolder('products/u1')).toBe(false);
  });
});

describe('response resolution', () => {
  const body = (value) => JSON.stringify({ success: true, data: value });
  const kyc = { _id: KYC_ID, visibility: 'private-kyc', ownerId: OWNER, storageKey: 'private/seller-documents/2026/11/x.pdf' };
  const attachment = { _id: RETURN_ID, visibility: 'private', ownerId: OWNER, storageKey: 'private/returns/2026/11/y.webp' };
  const signed = (text, key) => JSON.parse(text).data[key];

  test('responses without media references are untouched and cause no lookup', async () => {
    const text = body({ name: 'x', url: 'https://res.cloudinary.com/demo/a.jpg' });
    await expect(resolveResponseText(text, {})).resolves.toBe(text);
    expect(find).not.toHaveBeenCalled();
  });

  test('KYC: admin gets a valid signed link', async () => {
    mediaRows = [kyc];
    const out = await resolveResponseText(body({ frontUrl: `media:${KYC_ID}` }), { user: { _id: OTHER }, userType: 'admin' });
    const url = new URL(signed(out, 'frontUrl'));
    expect(url.pathname).toBe(`/media/s/${KYC_ID}`);
    expect(verifySignedRequest({ mediaId: KYC_ID, e: url.searchParams.get('e'), v: url.searchParams.get('v'), s: url.searchParams.get('s') })).toBe(true);
  });

  test('KYC: owner gets a link; another user and anonymous callers only see the opaque reference', async () => {
    mediaRows = [kyc];
    expect(signed(await resolveResponseText(body({ frontUrl: `media:${KYC_ID}` }), { user: { _id: OWNER }, userType: 'user' }), 'frontUrl')).toMatch(/\/media\/s\//);
    clearMediaUrlCache();
    expect(signed(await resolveResponseText(body({ frontUrl: `media:${KYC_ID}` }), { user: { _id: OTHER }, userType: 'user' }), 'frontUrl')).toBe(`media:${KYC_ID}`);
    clearMediaUrlCache();
    expect(signed(await resolveResponseText(body({ frontUrl: `media:${KYC_ID}` }), {}), 'frontUrl')).toBe(`media:${KYC_ID}`);
  });

  test('private attachments are signed for the authenticated viewer the endpoint served', async () => {
    mediaRows = [attachment];
    const out = await resolveResponseText(body({ url: `media:${RETURN_ID}` }), { user: { _id: OTHER }, userType: 'user' });
    expect(new URL(signed(out, 'url')).searchParams.get('v')).toBe(OTHER);
  });

  test('legacy Cloudinary URLs are mapped only when the read map is on and the copy is verified', async () => {
    const legacy = 'https://res.cloudinary.com/demo/image/upload/v1/nhcone/products/p.jpg';
    mediaRows = [{ _id: 'e'.repeat(24), visibility: 'public', storageKey: 'public/products/2026/11/p.jpg', legacy: { url: legacy } }];
    const text = body({ image: legacy });
    await expect(resolveResponseText(text, {})).resolves.toBe(text);
    process.env.MEDIA_LEGACY_READ_MAP = 'on';
    const out = await resolveResponseText(text, {});
    expect(signed(out, 'image')).toBe('https://api.example.test/media/products/2026/11/p.jpg');
    expect(find.mock.calls.at(-1)[0].$or).toEqual(expect.arrayContaining([{ 'legacy.url': { $in: [legacy] }, migrationStatus: 'verified' }]));
  });

  test('a migrated legacy KYC URL is withheld from users who may not view it', async () => {
    process.env.MEDIA_LEGACY_READ_MAP = 'on';
    const legacy = 'https://res.cloudinary.com/demo/image/upload/v1/nhcone/seller-kyc/u/a.jpg';
    mediaRows = [{ ...kyc, legacy: { url: legacy } }];
    const out = await resolveResponseText(body({ frontUrl: legacy }), { user: { _id: OTHER }, userType: 'user' });
    expect(signed(out, 'frontUrl')).toBe(`media:${KYC_ID}`);
  });

  test('a signed link the client echoes back is stored as the stable reference, even after expiry', async () => {
    const req = { user: { _id: OWNER }, userType: 'user', body: { landmarkImage: signedUrl(RETURN_ID, OWNER, Date.now() - 2 * 60 * 60 * 1000 + 3600 * 1000) } };
    await normalizeMediaInput(req);
    expect(req.body.landmarkImage).toBe(`media:${RETURN_ID}`);
  });

  test('a tampered signed link is not converted into a reference', async () => {
    const link = signedUrl(RETURN_ID, OWNER).replace(/s=[^&]+$/, 's=forged');
    const req = { user: { _id: OWNER }, userType: 'user', body: { landmarkImage: link } };
    await normalizeMediaInput(req);
    expect(req.body.landmarkImage).toBe(link);
  });

  test("a raw reference to someone else's file is dropped; the caller's own is kept", async () => {
    mediaRows = [{ _id: RETURN_ID }];
    const req = { user: { _id: OWNER }, userType: 'user', body: { mine: `media:${RETURN_ID}`, nested: [{ theirs: `media:${KYC_ID}` }] } };
    await normalizeMediaInput(req);
    expect(req.body.mine).toBe(`media:${RETURN_ID}`);
    expect(req.body.nested[0].theirs).toBeNull();
    expect(find.mock.calls.at(-1)[0]).toMatchObject({ ownerId: OWNER });
  });

  test('bodies without media values are not inspected further', async () => {
    const req = { user: { _id: OWNER }, body: { name: 'Home', line1: 'Street' } };
    await normalizeMediaInput(req);
    expect(find).not.toHaveBeenCalled();
    expect(req.body).toEqual({ name: 'Home', line1: 'Street' });
  });

  test('unknown references are left unchanged', async () => {
    mediaRows = [];
    const text = body({ url: `media:${'f'.repeat(24)}` });
    await expect(resolveResponseText(text, { user: { _id: OWNER } })).resolves.toBe(text);
  });
});
