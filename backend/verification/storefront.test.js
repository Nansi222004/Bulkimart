import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { storefrontRouter, storefrontAdminRouter } from '../routes/storefront.routes.js';
import bannerRoutes from '../routes/banner.routes.js';
import campaignRoutes from '../routes/campaign.routes.js';
import categoryRoutes from '../routes/category.routes.js';
import { errorHandler } from '../middlewares/error.middleware.js';
import Experience from '../models/StorefrontExperience.js';
import Banner from '../models/Banner.js';
import Campaign from '../models/Campaign.js';
import Participation from '../models/CampaignParticipation.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Admin from '../models/Admin.js';
import User from '../models/User.js';
import { signSessionToken } from '../config/jwt.js';
import { DEFAULT_TOKENS, PRESETS, PRESET_EFFECTS, DEFAULT_HEADER, DEFAULT_COUNTDOWN, lifecycle } from '../shared/storefront.mjs';
import { validateTokens, validateExperience, validateHeader } from '../services/storefrontPolicy.service.js';
import { resolveExperience } from '../services/storefront.service.js';
import { resolveCampaignPricesForProducts } from '../services/campaign.service.js';
import { DEFAULT_EFFECT, EFFECT_PRESETS } from '../shared/celebration.mjs';
import { v2 as cloudinary } from 'cloudinary';
import { cloudinaryConfig } from '../services/cloudinary.service.js';
const app = express(); app.use(express.json()); app.use('/api/storefront', storefrontRouter); app.use('/api/admin/storefront', storefrontAdminRouter); app.use('/api/banners', bannerRoutes); app.use('/api/campaigns', campaignRoutes); app.use('/api/categories', categoryRoutes); app.use(errorHandler);
let db, admin, marketer, viewer, buyer, banner;
const id = () => new mongoose.Types.ObjectId();
const token = (value, type = 'admin') => signSessionToken({ id: String(value), type });
const theme = extra => ({ kind: 'theme', name: 'Seasonal theme', description: 'Private planning notes', scope: 'global', config: { preset: 'Default Bulkimart', tokens: DEFAULT_TOKENS }, ...extra });
const promo = extra => ({ kind: 'campaign', name: 'Launch campaign', scope: 'global', config: { placement: 'splash', bannerId: String(banner._id), frequency: 'session', duration: 5 }, ...extra });
const send = (method, path, body, auth = admin) => { const req = request(app)[method](path); if (auth) req.set('Authorization', `Bearer ${auth}`); return body ? req.send(body) : req; };
const create = async payload => (await send('post', '/api/admin/storefront', payload).expect(201)).body.data;
const transition = async (row, action = 'publish', expected = 200) => (await send('post', `/api/admin/storefront/${row._id}/actions/${action}`, { revision: row.revision, draftRevision: row.draft?.revision }).expect(expected)).body;
const publicRead = async () => (await request(app).get('/api/storefront/experience?scope=quick&device=mobile').expect(200)).body.data;
beforeAll(async () => {
  db = await MongoMemoryServer.create({ binary: { version: '7.0.14' } }); await mongoose.connect(db.getUri());
  const ids = [id(), id(), id(), id()];
  await Admin.collection.insertMany([{ _id: ids[0], email: 'super@fixture.test', role: 'superAdmin', isActive: true }, { _id: ids[1], email: 'marketing@fixture.test', role: 'admin', permissions: ['manage_marketing'], isActive: true }, { _id: ids[2], email: 'viewer@fixture.test', role: 'admin', permissions: [], isActive: true }]);
  await User.collection.insertOne({ _id: ids[3], phone: '9000000000', roles: ['buyer'], isActive: true });
  [admin, marketer, viewer] = ids.slice(0, 3).map(x => token(x)); buyer = token(ids[3], 'user');
  await Experience.init();
});
beforeEach(async () => {
  await Promise.all([Experience.deleteMany({}), Banner.deleteMany({}), Campaign.deleteMany({}), Participation.deleteMany({}), Product.deleteMany({}), Category.deleteMany({})]);
  banner = await Banner.create({ title: 'Real campaign', image: 'https://cdn.example.test/banner.webp', type: 'general', placement: 'STUDIO', isActive: true });
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
test('legacy image and video records preserve inferred media types and safe playback defaults', async () => {
  await Banner.updateOne({ _id: banner._id }, { placement: 'HOME_HERO' });
  expect((await publicRead()).banners[0]).toMatchObject({ mediaType: 'image', image: banner.image });
  await Banner.collection.updateOne({ _id: banner._id }, { $set: { video: 'https://cdn.test/old.mp4' } });
  expect((await publicRead()).banners[0]).toMatchObject({ mediaType: 'video', autoplay: true, muted: true, loop: true, playsInline: true });
});
test('video drafts, responsive variants, publication, pause and archive use the existing Banner APIs', async () => {
  const payload = { title: 'Video promotion', image: banner.image, video: 'https://cdn.test/wide.mp4', mobileVideo: 'https://cdn.test/portrait.webm', mediaType: 'video', type: 'general', isDraft: true, autoplay: false, muted: false, loop: false, playsInline: false, animation: { ...DEFAULT_EFFECT, enabled: true, scope: 'banner' } };
  const row = (await send('post', '/api/banners', payload).expect(201)).body;
  expect((await publicRead()).banners).toEqual([]);
  await send('put', `/api/banners/${row._id}`, { isDraft: false }).expect(200);
  expect((await publicRead()).banners[0]).toMatchObject({ mediaType: 'video', mobileVideo: payload.mobileVideo, autoplay: false, loop: false, animation: { enabled: true } });
  await send('put', `/api/banners/${row._id}`, { isActive: false }).expect(200);
  expect((await publicRead()).banners).toEqual([]);
  await send('delete', `/api/banners/${row._id}`).expect(200);
  expect(await Banner.exists({ _id: row._id })).toBeTruthy();
});
test.each([
  { mediaType: 'video' }, { mediaType: 'script' }, { video: 'javascript:alert(1)' }, { video: 'https://cdn.test/page.html' },
  { mobileVideo: 'https://user:secret@cdn.test/a.mp4' }, { video: 'https://cdn.test/a.mp4', autoplay: true, muted: false }, { loop: 'yes' },
  { animation: { scope: 'storefront' } }, { animation: { enabled: 'yes', scope: 'banner' } },
])('banner media validation rejects %j without persistence', async patch => {
  const before = await Banner.countDocuments();
  await send('post', '/api/banners', { image: banner.image, type: 'general', ...patch }).expect(400);
  expect(await Banner.countDocuments()).toBe(before);
});
test.each([{ density: 101 }, { speed: 0 }, { opacity: 1 }, { duration: 121 }, { colors: ['red'] }, { preset: 'script' }, { scope: 'campaign' }, { startAt: '2030-01-01' }, { startAt: '2030-01-02T00:00:00Z', endAt: '2030-01-01T00:00:00Z' }, { javascript: 'alert(1)' }])('animation config rejects %j', async patch => {
  await send('post', '/api/admin/storefront', theme({ config: { animation: { ...DEFAULT_EFFECT, ...patch } } })).expect(400);
});
const diya = { id: 'custom-diya1', name: 'Diya rain', motion: 'fall', shape: 'emoji', emoji: '🪔', colors: ['#FFD45A'] };
test('custom animations combine with built-in presets and are stored with the configuration', async () => {
  const animation = { ...DEFAULT_EFFECT, enabled: true, presets: ['custom-diya1', 'lights'], customs: [diya, { ...diya, id: 'custom-stars', name: ' Stars ', motion: 'twinkle', shape: 'star', emoji: 'ignored' }] };
  const row = (await send('post', '/api/admin/storefront', theme({ config: { animation } })).expect(201)).body.data;
  const saved = (row.draft?.config || row.config).animation;
  expect(saved).toMatchObject({ preset: 'custom-diya1', presets: ['custom-diya1', 'lights'] });
  expect(saved.customs[1]).toEqual({ id: 'custom-stars', name: 'Stars', motion: 'twinkle', shape: 'star', emoji: '', colors: ['#FFD45A'] });
});
test.each([
  { presets: ['custom-missing'] }, { presets: ['lights', 'snowfall', 'petals', 'fireworks'] }, { presets: ['lights', 'lights'] },
  { customs: [{ ...diya, id: 'bad id' }] }, { customs: [{ ...diya, name: ' ' }] }, { customs: [{ ...diya, motion: 'spin' }] }, { customs: [{ ...diya, shape: 'svg' }] },
  { customs: [{ ...diya, emoji: '' }] }, { customs: [{ ...diya, emoji: '🪔🪔🪔🪔🪔' }] }, { customs: [{ ...diya, colors: ['javascript:'] }] }, { customs: [{ ...diya, script: 'x' }] },
  { customs: [diya, diya] }, { customs: Array.from({ length: 5 }, (_, i) => ({ ...diya, id: `custom-x${i}` })) },
])('custom animation config rejects %j', async patch => {
  await send('post', '/api/admin/storefront', theme({ config: { animation: { ...DEFAULT_EFFECT, enabled: true, ...patch } } })).expect(400);
});
test.each(EFFECT_PRESETS)('%s effect follows draft, schedule, device, pause, expiry and public minimization', async preset => {
  const start = Date.now() + 10000, end = start + 10000;
  let row = await create(theme({ device: 'mobile', config: { animation: { ...DEFAULT_EFFECT, enabled: true, preset, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() } } }));
  expect((await resolveExperience('quick', 'mobile', '', start)).animations).toEqual([]);
  row = (await transition(row)).data;
  expect((await resolveExperience('quick', 'mobile', '', start - 1)).animations).toEqual([]);
  const shown = await resolveExperience('quick', 'mobile', '', start);
  expect(shown.animations[0]).toMatchObject({ preset, id: row._id });
  expect(Date.parse(shown.validUntil)).toBe(end);
  expect(JSON.stringify(shown.animations)).not.toMatch(/createdBy|history|description/);
  expect((await resolveExperience('quick', 'desktop', '', start)).animations).toEqual([]);
  expect((await resolveExperience('quick', 'mobile', '', end)).animations).toEqual([]);
  await transition(row, 'pause');
  expect((await resolveExperience('quick', 'mobile', '', start)).animations).toEqual([]);
});
test('campaign effects rank deterministically and disappear with their banner or disabled configuration', async () => {
  const low = await create(promo({ priority: 1, config: { placement: 'hero', bannerId: String(banner._id), animation: { ...DEFAULT_EFFECT, enabled: true } } }));
  const high = await create(promo({ priority: 2, config: { placement: 'hero', bannerId: String(banner._id), animation: { ...DEFAULT_EFFECT, enabled: true, preset: 'snowfall' } } }));
  await transition(low); const published = (await transition(high)).data;
  const live = await publicRead(); expect(live.animations.map(e => e.id)).toEqual([high._id, low._id]);
  const edited = (await send('patch', `/api/admin/storefront/${high._id}`, { ...published, config: { ...published.config, animation: { ...published.config.animation, enabled: false } } }).expect(200)).body.data;
  expect((await publicRead()).animations.map(e => e.id)).toEqual([high._id, low._id]); // draft edit leaves live effect
  await transition(edited);
  expect((await publicRead()).animations.map(e => e.id)).toEqual([low._id]);
  await Banner.updateOne({ _id: banner._id }, { isActive: false });
  expect((await publicRead()).animations).toEqual([]);
});
test('banner effects are removed when expired in both public APIs', async () => {
  await Banner.updateOne({ _id: banner._id }, { placement: 'HOME_HERO', animation: { ...DEFAULT_EFFECT, scope: 'banner', enabled: true, endAt: new Date(Date.now() - 1).toISOString() } });
  expect((await publicRead()).banners[0].animation).toBeNull();
  const response = await request(app).get('/api/banners').expect(200);
  expect(response.body[0].animation).toBeNull(); expect(response.body[0].createdBy).toBeUndefined();
});
test('campaign-page effects require a live target and follow its expiry and pause', async () => {
  const dealId = id(), now = Date.now(), end = now + 60000;
  await Campaign.collection.insertOne({ _id: dealId, name: 'Deal page', isEnabled: true, isDraft: false, startAt: new Date(now - 1000), endAt: new Date(end) });
  const row = await create(theme({ config: { animation: { ...DEFAULT_EFFECT, enabled: true, scope: 'campaign', campaignId: String(dealId) } } }));
  await transition(row);
  expect((await publicRead()).animations[0]).toMatchObject({ scope: 'campaign', campaignId: String(dealId), endAt: new Date(end).toISOString() });
  expect((await resolveExperience('quick', 'mobile', '', end)).animations).toEqual([]);
  await Campaign.updateOne({ _id: dealId }, { isEnabled: false });
  expect((await publicRead()).animations).toEqual([]);
});
test('video uploads enforce size, marketing permission and Cloudinary processing before returning real storage URLs', async () => {
  await send('post', '/api/admin/storefront/media', null, viewer).attach('media', Buffer.from('file'), { filename: 'a.mp4', contentType: 'video/mp4' }).expect(403);
  await send('post', '/api/admin/storefront/media').attach('media', Buffer.alloc(15 * 1024 * 1024 + 1), { filename: 'a.mp4', contentType: 'video/mp4' }).expect(413);
  const old = { ...cloudinaryConfig }; Object.assign(cloudinaryConfig, { cloud_name: 'fixture', api_key: 'fixture', api_secret: 'fixture' });
  const upload = jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((_options, callback) => ({ end() { callback(null, { secure_url: 'https://res.cloudinary.com/fixture/video/upload/clip.mp4', duration: 12 }); } }));
  try {
    const data = Buffer.from('000000186674797069736f6d00000000', 'hex');
    const result = await send('post', '/api/admin/storefront/media').attach('media', data, { filename: 'a.mp4', contentType: 'video/mp4' }).expect(201);
    expect(result.body.data).toMatchObject({ type: 'video', duration: 12, url: 'https://res.cloudinary.com/fixture/video/upload/clip.mp4' });
    expect(upload.mock.calls[0][0]).toMatchObject({ resource_type: 'video', format: 'mp4', video_codec: 'h264', transformation: [{ duration: '15', width: 1280, crop: 'limit' }] });
    upload.mockImplementation((_options, callback) => ({ end() { callback({ http_code: 400, message: 'Invalid container private-provider-detail' }); } }));
    const rejected = await send('post', '/api/admin/storefront/media').attach('media', data, { filename: 'a.mp4', contentType: 'video/mp4' }).expect(502);
    expect(rejected.body.message).not.toContain('private-provider-detail');
  } finally { upload.mockRestore(); for (const key of Object.keys(cloudinaryConfig)) delete cloudinaryConfig[key]; Object.assign(cloudinaryConfig, old); }
});
test('the default experience skips empty deal and category-reference queries', async () => {
  const deals = jest.spyOn(Campaign, 'find'), categories = jest.spyOn(Category, 'find');
  try {
    const data = await publicRead();
    expect(data.splash).toBeNull(); expect(data.sections).toEqual([]);
    expect(deals).not.toHaveBeenCalled(); expect(categories).toHaveBeenCalledTimes(1);
    expect(categories.mock.calls[0][0]).toMatchObject({ parent: null, showInNav: true });
  } finally { deals.mockRestore(); categories.mockRestore(); }
});

test('header categories are explicitly selected, scoped, active roots in admin order, without a fallback', async () => {
  expect((await publicRead()).headerCategories).toEqual([]);
  const first = await Category.create({ name: 'First', type: 'grocery', slug: 'grocery--first', showInNav: true, sortOrder: 1, image: '/uploads/category.webp' });
  await Category.create([
    { name: 'Third', type: 'grocery', slug: 'grocery--third', showInNav: true, sortOrder: 3 },
    { name: 'Second', type: 'grocery', slug: 'grocery--second', showInNav: true, sortOrder: 2 },
    { name: 'Unselected', type: 'grocery', slug: 'grocery--unselected' },
    { name: 'Inactive', type: 'grocery', slug: 'grocery--inactive', showInNav: true, isActive: false },
    { name: 'System', type: 'grocery', slug: 'grocery--system', showInNav: true, isSystem: true },
    { name: 'Child', type: 'grocery', slug: 'grocery--child', showInNav: true, parent: first._id },
    { name: 'ShopAll', type: 'ecommerce', slug: 'ecommerce--shopall', showInNav: true },
  ]);
  const shown = await publicRead();
  expect(shown.headerCategories.map(c => c.name)).toEqual(['First', 'Second', 'Third']);
  expect(shown.headerCategories[0].image).toBe('/uploads/category.webp');
  expect(shown.headerCategories[0].showInNav).toBeUndefined();
  expect((await resolveExperience('shop-all', 'mobile')).headerCategories.map(c => c.name)).toEqual(['ShopAll']);
  await Category.updateOne({ _id: first._id }, { showInNav: false });
  const changed = await publicRead();
  expect(changed.version).not.toBe(shown.version);
  expect(changed.headerCategories.map(c => c.name)).toEqual(['Second', 'Third']);
});
test('admin category creation and editing control header visibility, status and order', async () => {
  const created = (await send('post', '/api/categories', { name: 'Hidden header', type: 'grocery', showInNav: true, isActive: false, sortOrder: 4 }).expect(201)).body.category;
  expect(created.isActive).toBe(false);
  expect((await publicRead()).headerCategories).toEqual([]);
  await send('put', `/api/categories/${created._id}`, { isActive: true, sortOrder: 1 }).expect(200);
  expect((await publicRead()).headerCategories[0]).toMatchObject({ _id: created._id, sortOrder: 1 });
  await send('put', `/api/categories/${created._id}`, { showInNav: false }).expect(200);
  expect((await publicRead()).headerCategories).toEqual([]);
});
test('unauthenticated access is denied across list, drafts, actions and media', async () => {
  for (const [method, path, body] of [['get', '/api/admin/storefront'], ['post', '/api/admin/storefront', theme()], ['post', `/api/admin/storefront/${id()}/actions/publish`, { revision: 1 }], ['post', '/api/admin/storefront/media']]) await send(method, path, body, null).expect(401);
});
test('buyer and unprivileged admin cannot manage marketing; explicit permission can', async () => {
  await send('get', '/api/admin/storefront', null, buyer).expect(403); await send('post', '/api/admin/storefront', theme(), viewer).expect(403);
  await send('post', '/api/admin/storefront', theme(), marketer).expect(201);
});
test('legacy all=true banner listing requires server authentication and permission', async () => {
  await request(app).get('/api/banners?all=true').expect(401); await send('get', '/api/banners?all=true', null, buyer).expect(403); await send('get', '/api/banners?all=true', null, viewer).expect(403);
  await send('get', '/api/banners?all=true').expect(200);
});
test('theme CRUD, draft isolation, publication, revision and private field projection', async () => {
  let row = await create(theme()); expect((await publicRead()).theme.tokens).toEqual(DEFAULT_TOKENS);
  row = (await transition(row)).data; expect((await publicRead()).theme.id).toBe(row._id);
  const payload = await publicRead(); expect(JSON.stringify(payload)).not.toMatch(/Private planning|createdBy|history|updatedBy|description/);
  row = (await send('patch', `/api/admin/storefront/${row._id}`, { ...theme({ name: 'Edited' }), revision: row.revision }).expect(200)).body.data;
  expect(row.status).toBe('published'); expect(row.draft.values.name).toBe('Edited'); expect((await publicRead()).theme.id).toBe(row._id);
  expect(JSON.stringify(await publicRead())).not.toMatch(/Edited|draft/);
  row = (await transition(row)).data; expect(row.name).toBe('Edited'); expect(row.draft).toBeNull(); expect((await publicRead()).theme.id).toBe(row._id);
});
test.each(['draft', 'paused', 'archived'])('%s never appears publicly', async status => {
  const row = await create(promo()); if (status !== 'draft') { const published = (await transition(row)).data; await transition(published, status === 'paused' ? 'pause' : 'archive'); }
  expect((await publicRead()).splash).toBeNull();
});
test('schedules are start-inclusive and end-exclusive with exact boundaries', async () => {
  const start = Date.now() + 10000, end = start + 10000;
  const row = await create(promo({ startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() })); await transition(row);
  expect((await resolveExperience('quick', 'mobile', '', start - 1)).splash).toBeNull();
  expect((await resolveExperience('quick', 'mobile', '', start)).splash.id).toBe(row._id);
  expect((await resolveExperience('quick', 'mobile', '', end)).splash).toBeNull();
});
test('timezone offsets store the same UTC instant and timezone-free dates fail', async () => {
  const row = await create(theme({ startAt: '2030-01-01T05:30:00+05:30' })); expect(row.startAt).toBe('2030-01-01T00:00:00.000Z');
  await send('post', '/api/admin/storefront', theme({ startAt: '2030-01-01T05:30' })).expect(400);
});
test.each([
  { name: '' }, { priority: -1 }, { priority: '10' }, { device: 'tablet' }, { scope: 'seller' },
  { startAt: 'broken' }, { startAt: '2030-02-02T00:00:00Z', endAt: '2030-02-01T00:00:00Z' },
  { config: { tokens: { ...DEFAULT_TOKENS, primary: 'url(javascript:alert(1))' } } },
  { config: { tokens: { ...DEFAULT_TOKENS, text: '#ffffff' } } },
])('invalid payload %j fails without persistence', async patch => {
  await send('post', '/api/admin/storefront', theme(patch)).expect(400); expect(await Experience.countDocuments()).toBe(0);
});
test('all shipped presets pass color and vocabulary validation', () => { for (const tokens of Object.values(PRESETS)) expect(() => validateTokens(tokens)).not.toThrow(); });
test('default is premium red and classic aqua is explicitly selectable', async () => {
  expect((await publicRead()).theme.tokens.primary).toBe('#B50918');
  expect(DEFAULT_TOKENS.header).toBe('#79000B');
  const row = await create(theme({ config: { preset: 'Classic Aqua', tokens: PRESETS['Classic Aqua'] } }));
  await transition(row); expect((await publicRead()).theme.tokens.primary).toBe('#087ea4');
});
test('component colors persist, refresh versions and survive publication rollback', async () => {
  let row = await create(theme({ config: { tokens: { ...DEFAULT_TOKENS, header: '#512020', action: '#991B1B', categoryFrame: '#B5811C', product: 'flat' } } }));
  row = (await transition(row)).data;
  const first = await publicRead(); expect(first.theme.tokens.header).toBe('#512020'); expect(first.theme.tokens.product).toBe('flat');
  row = (await send('patch', `/api/admin/storefront/${row._id}`, { ...row, config: { ...row.config, tokens: { ...row.config.tokens, header: '#252525' } } }).expect(200)).body.data;
  row = (await transition(row)).data; const second = await publicRead();
  expect(second.version).not.toBe(first.version); expect(second.theme.tokens.header).toBe('#252525');
  await transition(row, 'rollback'); expect((await publicRead()).theme.tokens.header).toBe('#512020');
});
test('paused and expired themes restore the red default', async () => {
  const end = Date.now() + 10000;
  let row = await create(theme({ endAt: new Date(end).toISOString(), config: { tokens: PRESETS['Eid Celebration'] } }));
  row = (await transition(row)).data;
  expect((await resolveExperience('quick', 'mobile', '', end - 1)).theme.tokens.primary).toBe('#116b52');
  expect((await resolveExperience('quick', 'mobile', '', end)).theme.tokens.primary).toBe('#B50918');
  await transition(row, 'pause'); expect((await publicRead()).theme.tokens.header).toBe('#79000B');
});
test('campaign-only theme ends with its campaign even if the theme has no end date', async () => {
  await transition(await create(theme()));
  const row = await create(theme({ config: { tokens: PRESETS['Eid Celebration'], application: 'campaign' } })); await transition(row);
  expect((await publicRead()).theme.tokens.primary).toBe('#B50918');
  const end = Date.now() + 10000;
  let campaign = await create(promo({ endAt: new Date(end).toISOString(), config: { ...promo().config, themeId: row._id } })); campaign = (await transition(campaign)).data;
  expect((await resolveExperience('quick', 'mobile', '', end - 1)).theme.tokens.primary).toBe('#116b52');
  expect((await resolveExperience('quick', 'mobile', '', end)).theme.tokens.primary).toBe('#B50918');
  await transition(campaign, 'pause'); expect((await publicRead()).theme.tokens.primary).toBe('#B50918');
});
test.each(['header', 'searchText', 'actionText', 'badgeText', 'navActive'])('rejects unreadable or executable %s component colors', async key => {
  await send('post', '/api/admin/storefront', theme({ config: { tokens: { ...DEFAULT_TOKENS, [key]: ['actionText', 'badgeText'].includes(key) ? '#D91430' : '#FFFFFF' } } })).expect(400);
  await send('post', '/api/admin/storefront', theme({ config: { tokens: { ...DEFAULT_TOKENS, [key]: 'url(https://bad.test)' } } })).expect(400);
});
test('section colors and layout persist through the existing API, unsafe CSS fails', async () => {
  const config = { source: 'price', title: 'Under ₹99', maxPrice: 99, layout: 'grid', variant: 'accent', appearance: { background: '#FFF0B3', text: '#252525', accent: '#B50918' } };
  const row = await create({ kind: 'section', name: 'Budget finds', config }); await transition(row);
  expect((await publicRead()).sections[0].config).toMatchObject(config);
  await send('post', '/api/admin/storefront', { kind: 'section', name: 'Unsafe', config: { ...config, appearance: { ...config.appearance, background: 'url(x)' } } }).expect(400);
  await send('post', '/api/admin/storefront', { kind: 'section', name: 'Unreadable', config: { ...config, appearance: { background: '#FFFFFF', text: '#FFFFFF' } } }).expect(400);
});
test('category artwork uses live category and banner references and disappears when retired', async () => {
  const category = await Category.create({ name: 'Fresh', slug: 'grocery--fresh', type: 'grocery', isActive: true });
  const row = await create(theme({ config: { tokens: DEFAULT_TOKENS, categoryTiles: [{ categoryId: String(category._id), bannerId: String(banner._id), badge: 'Fresh picks' }] } }));
  await transition(row); const first = await publicRead();
  expect(first.theme.categoryTiles[0].banner.image).toBe(banner.image);
  expect(first.theme.categoryTiles[0].badge).toBe('Fresh picks');
  expect((await resolveExperience('shop-all', 'mobile')).theme.categoryTiles).toEqual([]);
  await Banner.updateOne({ _id: banner._id }, { isArchived: true }); expect((await publicRead()).theme.categoryTiles).toEqual([]);
});
test('input cannot set publication, audit metadata or unvalidated CSS', async () => {
  const row = await create(theme({ status: 'published', revision: 999, createdBy: String(id()), config: { tokens: DEFAULT_TOKENS, css: 'body{display:none}' } }));
  expect(row.status).toBe('draft'); expect(row.revision).toBe(1); expect(row.config.css).toBeUndefined();
});
test('same-priority overlapping placement returns actionable conflict; adjacent is allowed', async () => {
  const now = Date.now() + 10000;
  const one = await create(promo({ endAt: new Date(now).toISOString() })); await transition(one);
  const two = await create(promo()); const conflict = await transition(two, 'publish', 409); expect(conflict.message).toMatch(/priority/);
  const three = await create(promo({ startAt: new Date(now).toISOString() })); await transition(three);
});
test('higher priority wins independent of insertion order; lower priority falls back', async () => {
  const low = await create(promo({ priority: 2 })), high = await create(promo({ priority: 10 })); await transition(low); const published = (await transition(high)).data;
  expect((await publicRead()).splash.id).toBe(high._id); await transition(published, 'pause'); expect((await publicRead()).splash.id).toBe(low._id);
});
test('scope and device filter on the server', async () => {
  const row = await create(promo({ scope: 'shop-all', device: 'desktop' })); await transition(row);
  expect((await publicRead()).splash).toBeNull(); expect((await resolveExperience('shop-all', 'desktop')).splash.id).toBe(row._id);
});
test('theme resolution is campaign override then scoped then global then defaults', async () => {
  const global = await create(theme()), scoped = await create(theme({ scope: 'quick', priority: 5 })); const g = (await transition(global)).data; await transition(scoped);
  expect((await publicRead()).theme.id).toBe(scoped._id);
  let campaign = await create(promo({ config: { ...promo().config, themeId: global._id } })); campaign = (await transition(campaign)).data;
  expect((await publicRead()).theme.id).toBe(global._id); await transition(g, 'pause'); expect((await publicRead()).theme.id).toBe(scoped._id);
});
test('rollback restores prior publication with a new frequency revision', async () => {
  let row = (await transition(await create(theme()))).data;
  row = (await send('patch', `/api/admin/storefront/${row._id}`, { ...theme(), revision: row.revision, config: { tokens: PRESETS['Eid Celebration'] } }).expect(200)).body.data;
  row = (await transition(row)).data; const version = (await publicRead()).version;
  const previous = (await transition(row, 'rollback')).data;
  expect(previous.config.tokens).toEqual(DEFAULT_TOKENS); expect(previous.revision).toBeGreaterThan(row.revision); expect((await publicRead()).version).not.toBe(version);
});
test('stale update and lifecycle revision return 409', async () => {
  const row = await create(theme()); await transition(row); await transition(row, 'pause', 409);
  await send('patch', `/api/admin/storefront/${row._id}`, { ...theme(), revision: row.revision }).expect(409);
});
test('missing, draft and wrong-storefront references prevent publication', async () => {
  const missing = await create(promo({ config: { ...promo().config, bannerId: String(id()) } })); await transition(missing, 'publish', 400);
  await Banner.updateOne({ _id: banner._id }, { isDraft: true }); await transition(await create(promo()), 'publish', 400);
  await Banner.updateOne({ _id: banner._id }, { isDraft: false, type: 'grocery' }); await transition(await create(promo({ scope: 'shop-all' })), 'publish', 400);
});
test('legacy missing placement remains visible; Studio artwork does not leak into hero', async () => {
  const legacy = { _id: id(), title: 'Existing banner', image: 'https://cdn.example.test/old.jpg', type: 'grocery', isActive: true, createdBy: id(), clickCount: 500 };
  await Banner.collection.insertOne(legacy); const payload = await publicRead(); expect(payload.banners.map(b => b.id)).toEqual([String(legacy._id)]); expect(payload.banners[0].createdBy).toBeUndefined();
});
test('banner archive preserves media and disappears from both public feeds', async () => {
  await Banner.updateOne({ _id: banner._id }, { placement: 'HOME_HERO' }); await send('delete', `/api/banners/${banner._id}`).expect(200);
  expect((await Banner.findById(banner._id)).image).toBe(banner.image); expect((await publicRead()).banners).toEqual([]); expect((await request(app).get('/api/banners').expect(200)).body).toEqual([]);
});
test.each(['javascript:alert(1)', 'data:text/html,hello', 'http://example.test', 'https://user:password@example.test'])('unsafe destination %s is rejected even for drafts', async externalUrl => {
  await send('post', '/api/banners', { title: 'Test', type: 'general', image: banner.image, actionType: 'EXTERNAL_URL', externalUrl, isDraft: true }).expect(400);
});
test('banner responsive media, destination and ordering persist', async () => {
  const response = await send('post', '/api/banners', { title: 'Responsive', type: 'general', image: banner.image, mobileImage: 'https://cdn.example.test/mobile.webp', video: 'https://cdn.example.test/clip.mp4', cta: 'Browse', priority: 8 }).expect(201);
  const payload = await publicRead(); expect(payload.banners[0]).toMatchObject({ id: response.body._id, mobileImage: 'https://cdn.example.test/mobile.webp', cta: 'Browse' });
});
test('media upload rejects unsupported MIME, mismatched extension and invalid raster/video bytes', async () => {
  await send('post', '/api/admin/storefront/media').attach('media', Buffer.from('<svg/>'), { filename: 'x.svg', contentType: 'image/svg+xml' }).expect(400);
  await send('post', '/api/admin/storefront/media').attach('media', Buffer.from('bad'), { filename: 'x.png', contentType: 'video/mp4' }).expect(400);
  await send('post', '/api/admin/storefront/media').attach('media', Buffer.from('bad'), { filename: 'x.png', contentType: 'image/png' }).expect(400);
  await send('post', '/api/admin/storefront/media').attach('media', Buffer.from('bad'), { filename: 'x.mp4', contentType: 'video/mp4' }).expect(400);
});
test('sections persist, order deterministically, hide after pause and reject unsupported sources', async () => {
  const section = order => ({ kind: 'section', name: `Section ${order}`, order, config: { source: 'price', maxPrice: 99, title: 'Under ₹99', limit: 8 } });
  let last = await create(section(20)); const first = await create(section(1)); last = (await transition(last)).data; await transition(first);
  expect((await publicRead()).sections.map(s => s.order)).toEqual([1, 20]); await transition(last, 'pause'); expect((await publicRead()).sections).toHaveLength(1);
  await send('post', '/api/admin/storefront', { ...section(2), config: { source: 'fake-best-seller' } }).expect(400);
});
test('flash sale uses accepted seller prices and expires independently of storefront cache', async () => {
  const now = Date.now(), productId = id(), sellerId = id();
  const campaign = await Campaign.create({ name: 'Approved deal', isDraft: false, isEnabled: true, startAt: new Date(now - 1000), endAt: new Date(now + 20000) });
  await Product.collection.insertOne({ _id: productId, name: 'Fixture product', price: 100, stock: 5, type: 'grocery', isActive: true, isDeleted: false, status: 'approved', sellerId });
  await Participation.create({ campaignId: campaign._id, productId, sellerId, status: 'ACCEPTED', campaignPrice: 80, discountValue: 20, originalPriceSnapshot: 100 });
  const section = await create({ kind: 'section', name: 'Flash sale', config: { source: 'campaign', campaignId: String(campaign._id) } }); await transition(section);
  const payload = await publicRead(); expect(payload.sections[0].endAt).toBe(campaign.endAt.toISOString()); expect(Date.parse(payload.validUntil)).toBeLessThanOrEqual(campaign.endAt.getTime());
  const products = (await request(app).get(`/api/campaigns/${campaign._id}/products`).expect(200)).body.data.products; expect(products[0].campaignPrice).toBe(80);
  expect((await resolveCampaignPricesForProducts([productId])).get(String(productId)).campaignPrice).toBe(80);
  await Campaign.updateOne({ _id: campaign._id }, { endAt: new Date(now - 1) });
  expect((await publicRead()).sections).toEqual([]); expect((await resolveCampaignPricesForProducts([productId])).size).toBe(0);
});
test('configuration version changes on publish and pause; safe default has bounded freshness', async () => {
  const initial = await publicRead(); expect(initial.theme.tokens).toEqual(DEFAULT_TOKENS); expect(Date.parse(initial.validUntil) - Date.parse(initial.serverTime)).toBeLessThanOrEqual(30000);
  const row = (await transition(await create(promo()))).data; const active = await publicRead(); expect(active.version).not.toBe(initial.version);
  await transition(row, 'pause'); expect((await publicRead()).version).toBe(initial.version);
});
test('pagination and lifecycle filtering exclude unrelated records', async () => {
  await create(theme()); const row = await create(promo()); await transition(row);
  const result = await send('get', '/api/admin/storefront?kind=campaign&status=active&limit=1').expect(200);
  expect(result.body.meta.total).toBe(1); expect(result.body.data[0].kind).toBe('campaign');
});
test('corrupt published configuration safely falls back and cannot leak unknown config fields', async () => {
  await Experience.collection.insertOne({ kind: 'theme', name: 'Broken', status: 'published', scope: 'global', device: 'all', config: { tokens: { primary: 'url(https://evil.test)' } } });
  expect((await publicRead()).theme.tokens).toEqual(DEFAULT_TOKENS);
  const valid = await create(promo()); await transition(valid);
  await Experience.collection.updateOne({ _id: new mongoose.Types.ObjectId(valid._id) }, { $set: { 'config.privateNote': 'never public' } });
  expect(JSON.stringify(await publicRead())).not.toContain('never public');
});
test('category section stops rendering when its category becomes unavailable', async () => {
  const cat = await Category.create({ name: 'Fruit', type: 'grocery' });
  const row = await create({ kind: 'section', name: 'Fruit picks', scope: 'quick', config: { source: 'category', categoryId: String(cat._id) } }); await transition(row);
  expect((await publicRead()).sections).toHaveLength(1);
  await Category.updateOne({ _id: cat._id }, { isActive: false }); expect((await publicRead()).sections).toHaveLength(0);
});
test('archived banners can be restored as drafts without becoming public', async () => {
  await send('delete', `/api/banners/${banner._id}`).expect(200);
  await send('put', `/api/banners/${banner._id}`, { isArchived: false, isDraft: true, isActive: false }).expect(200);
  expect((await Banner.findById(banner._id)).isArchived).toBe(false); expect((await publicRead()).banners).toEqual([]);
});
test('legacy grocery and garment destinations keep supported navigation', async () => {
  await Banner.collection.insertOne({ title: 'Legacy grocery', image: banner.image, type: 'grocery', targetRoute: '/grocery', isActive: true });
  expect((await publicRead()).banners[0].destination).toEqual({ type: 'SUBNAV', id: 'groceries' });
});

// Festive header and animation presets: closed vocabulary, draft isolation and public projection.
const festive = (header = {}) => theme({ config: { preset: 'Diwali Celebration', tokens: PRESETS['Diwali Celebration'], header: { ...DEFAULT_HEADER, enabled: true, title: 'Festive Sale', subtitle: 'Lights and gifts', ...header },
  animation: { ...DEFAULT_EFFECT, enabled: true, preset: 'lights', scope: 'homepage', intensity: 'high', size: 1.5, duration: 0, reducedMotion: 'static' } } });
test.each([
  [{ title: '' }], [{ title: 'x'.repeat(61) }], [{ background: '#ffffff', text: '#eeeeee' }], [{ height: 1000 }], [{ height: 80 }],
  [{ image: 'http://insecure.test/art.png' }], [{ image: 'https://cdn.test/art.svg' }], [{ image: 'javascript:alert(1)' }],
  [{ target: 'campaign' }], [{ target: 'categories', cta: '' }], [{ target: 'https://evil.test' }], [{ html: '<script>alert(1)</script>' }],
  [{ countdown: { enabled: true } }], [{ countdown: { enabled: true, endAt: '2030-01-01T00:00' } }], [{ countdown: { enabled: true, onExpire: 'alert(1)', endAt: '2030-01-01T00:00:00Z' } }],
  [{ countdown: { enabled: true, startAt: '2030-01-02T00:00:00Z', endAt: '2030-01-01T00:00:00Z' } }],
])('festive header rejects %j', async header => { await send('post', '/api/admin/storefront', festive(header)).expect(400); });
test.each([{ intensity: 'extreme' }, { size: 3 }, { size: 0.1 }, { direction: 'up' }, { reducedMotion: 'flash' }, { duration: -1 }, { preset: 'lasers' }])('festive animation rejects %j', async patch => {
  const payload = festive(); payload.config.animation = { ...payload.config.animation, ...patch };
  await send('post', '/api/admin/storefront', payload).expect(400);
});
test('festive header and animation persist as a draft, publish publicly, and roll back with the theme', async () => {
  const countdown = { ...DEFAULT_COUNTDOWN, enabled: true, title: 'Diwali Sale', startAt: '2030-11-01T00:00:00+05:30', endAt: '2030-11-03T00:00:00+05:30', expiredText: 'See you next year' };
  let row = await create(festive({ height: 240, target: 'categories', cta: 'Shop now', image: 'https://cdn.fixture.test/diya.webp', countdown }));
  expect(row.config.header).toMatchObject({ enabled: true, height: 240, target: 'categories', countdown: { enabled: true, showRemaining: true } });
  expect(row.config.animation).toMatchObject({ preset: 'lights', intensity: 'high', size: 1.5, duration: 0, reducedMotion: 'static', direction: 'down' });
  expect((await publicRead()).theme.header).toBeUndefined(); // draft is Admin-only
  row = (await transition(row)).data;
  const published = await publicRead();
  expect(published.theme.header).toEqual(row.config.header);
  expect(published.animations).toEqual([expect.objectContaining({ preset: 'lights', intensity: 'high', scope: 'homepage' })]);
  expect(JSON.stringify(published)).not.toMatch(/Private planning|history|createdBy/);
  // Editing a live theme saves a draft copy; the live header stays until the draft is published.
  row = (await send('patch', `/api/admin/storefront/${row._id}`, { ...festive({ title: 'Winter Sale', countdown }), revision: row.revision }).expect(200)).body.data;
  expect((await publicRead()).theme.header.title).toBe('Festive Sale');
  row = (await transition(row)).data; expect((await publicRead()).theme.header.title).toBe('Winter Sale');
  await transition(row, 'rollback'); expect((await publicRead()).theme.header.title).toBe('Festive Sale');
});
test('legacy themes without a header resolve to a disabled default header', async () => {
  await Experience.collection.insertOne({ kind: 'theme', name: 'Legacy', status: 'published', scope: 'global', device: 'all', priority: 0, order: 0, revision: 1, timezone: 'Asia/Kolkata', config: { preset: 'Default Bulkimart', tokens: DEFAULT_TOKENS } });
  const data = await publicRead();
  expect(data.theme.header).toEqual(DEFAULT_HEADER); expect(data.animations).toEqual([]);
});
test('a header button to an unavailable deal blocks publication and is dropped publicly if the deal later ends', async () => {
  const missing = await create(festive({ target: 'campaign', cta: 'Shop deal', campaignId: String(id()) }));
  await transition(missing, 'publish', 400);
  const deal = await Campaign.collection.insertOne({ name: 'Live deal', isEnabled: true, isDraft: false, startAt: new Date(Date.now() - 60000), endAt: new Date(Date.now() + 3600000), discountValue: 10 });
  const row = (await transition(await create(festive({ target: 'campaign', cta: 'Shop deal', campaignId: String(deal.insertedId) })))).data;
  expect((await publicRead()).theme.header).toMatchObject({ target: 'campaign', campaignId: String(deal.insertedId) });
  await Campaign.collection.updateOne({ _id: deal.insertedId }, { $set: { isEnabled: false } });
  expect((await publicRead()).theme.header).toMatchObject({ target: 'none', campaignId: '' });
  expect(row.status).toBe('published');
});
test('festive presets suggest valid animations and ship contrast-valid header colours', () => {
  for (const [name, preset] of Object.entries(PRESET_EFFECTS)) {
    expect(EFFECT_PRESETS).toContain(preset);
    const tokens = PRESETS[name]; expect(() => validateTokens(tokens)).not.toThrow();
    expect(() => validateHeader({ ...DEFAULT_HEADER, enabled: true, title: name, background: tokens.header, text: tokens.headerText })).not.toThrow();
  }
});

// Safe draft editing: a published record keeps its live version until its draft is published.
const live = async (header = {}) => (await transition(await create(festive(header)))).data;
const saveDraft = async (row, header, extra = {}, expected = 200) => (await send('patch', `/api/admin/storefront/${row._id}`, { ...festive(header), revision: row.revision, draftRevision: row.draft?.revision, ...extra }).expect(expected)).body.data;
test('editing a live theme saves a reloadable draft and leaves the public payload byte-identical', async () => {
  const row = await live();
  const before = await publicRead();
  const draft = await saveDraft(row, { title: 'Winter Sale' }, { name: 'Winter edit' });
  expect(draft).toMatchObject({ status: 'published', revision: row.revision, name: 'Seasonal theme', draft: { revision: 1, stale: false, values: { name: 'Winter edit' } } });
  expect(draft.draft.values.config.header.title).toBe('Winter Sale');
  const after = await publicRead();
  expect({ ...after, serverTime: 0, validUntil: 0 }).toEqual({ ...before, serverTime: 0, validUntil: 0 });
  // Reload: the admin list returns the saved draft beside the unchanged live fields.
  const listed = (await send('get', '/api/admin/storefront?kind=theme').expect(200)).body.data.find(r => r._id === row._id);
  expect(listed.config.header.title).toBe('Festive Sale'); expect(listed.draft.values.config.header.title).toBe('Winter Sale');
  expect(JSON.stringify(after)).not.toMatch(/Winter/);
  // Stored live fields are untouched in the database too.
  const stored = await Experience.findById(row._id).lean();
  expect(stored.config.header.title).toBe('Festive Sale'); expect(stored.revision).toBe(row.revision);
});
test('publishing the draft swaps it in atomically, bumps the public revision, records history and clears the draft', async () => {
  const row = await live();
  const draft = await saveDraft(row, { title: 'Winter Sale' });
  const published = (await transition(draft)).data;
  expect(published).toMatchObject({ status: 'published', revision: row.revision + 1, draft: null, canRollback: true });
  expect((await publicRead()).theme.header.title).toBe('Winter Sale');
  expect((await Experience.findById(row._id).select('+history').lean()).history.map(h => h.config.header.title)).toEqual(['Festive Sale', 'Winter Sale']);
});
test('cancelling a draft discards it without touching the live version or its revision', async () => {
  const row = await live(); const version = (await publicRead()).version;
  const draft = await saveDraft(row, { title: 'Abandoned' });
  const discarded = (await send('post', `/api/admin/storefront/${row._id}/actions/discard`, { revision: draft.revision, draftRevision: draft.draft.revision }).expect(200)).body.data;
  expect(discarded).toMatchObject({ draft: null, revision: row.revision, status: 'published' });
  expect((await publicRead()).version).toBe(version);
  await send('post', `/api/admin/storefront/${row._id}/actions/discard`, { revision: discarded.revision }).expect(400);
});
test('stale draft saves, stale publishes and stale discards are rejected with 409', async () => {
  const row = await live();
  const first = await saveDraft(row, { title: 'Editor A' });
  await saveDraft(row, { title: 'Editor B' }, {}, 409); // B opened before A saved (no draftRevision)
  const second = await saveDraft(first, { title: 'Editor A again' });
  expect(second.draft.revision).toBe(2);
  await send('post', `/api/admin/storefront/${row._id}/actions/publish`, { revision: row.revision, draftRevision: 1 }).expect(409);
  await send('post', `/api/admin/storefront/${row._id}/actions/discard`, { revision: row.revision, draftRevision: 1 }).expect(409);
  await send('post', `/api/admin/storefront/${row._id}/actions/publish`, { revision: row.revision - 1, draftRevision: 2 }).expect(409);
  expect((await publicRead()).theme.header.title).toBe('Festive Sale');
  // Two publishes of the same draft: the second is stale.
  await transition(second); await send('post', `/api/admin/storefront/${row._id}/actions/publish`, { revision: second.revision, draftRevision: 2 }).expect(409);
  expect((await publicRead()).theme.header.title).toBe('Editor A again');
});
test('a draft cannot overwrite a live version that changed after it was saved (rollback), until it is re-saved', async () => {
  let row = await live();
  row = (await transition(await saveDraft(row, { title: 'Second' }))).data; // live: Second
  const draft = await saveDraft(row, { title: 'Third' });
  const rolled = (await transition(draft, 'rollback')).data; // live: Festive Sale, draft kept
  expect((await publicRead()).theme.header.title).toBe('Festive Sale');
  expect(rolled.draft).toMatchObject({ revision: 1, stale: true });
  await send('post', `/api/admin/storefront/${row._id}/actions/publish`, { revision: rolled.revision, draftRevision: 1 }).expect(409);
  expect((await publicRead()).theme.header.title).toBe('Festive Sale');
  const reviewed = await saveDraft(rolled, { title: 'Third' });
  expect(reviewed.draft).toMatchObject({ revision: 2, stale: false });
  await transition(reviewed); expect((await publicRead()).theme.header.title).toBe('Third');
});
test('invalid or expired drafts fail publication and leave the live version intact', async () => {
  const row = await live();
  await saveDraft(row, { title: '' }, {}, 400); // validated on save, nothing stored
  expect((await Experience.findById(row._id).lean()).draft).toBeUndefined();
  const expired = await saveDraft(row, {}, { startAt: '2020-01-01T00:00:00Z', endAt: '2020-01-02T00:00:00Z' });
  await send('post', `/api/admin/storefront/${row._id}/actions/publish`, { revision: expired.revision, draftRevision: 1 }).expect(400);
  const stored = await Experience.findById(row._id).lean();
  expect(stored).toMatchObject({ status: 'published', revision: row.revision, endAt: null }); expect(stored.draft.revision).toBe(1);
  expect((await publicRead()).theme.header.title).toBe('Festive Sale');
});
test('a scheduled draft keeps the current live version until published, then follows its schedule', async () => {
  const row = await live();
  const start = new Date(Date.now() + 3600000).toISOString();
  const draft = await saveDraft(row, { title: 'Tomorrow' }, { startAt: start });
  expect((await publicRead()).theme.header.title).toBe('Festive Sale');
  const scheduled = (await transition(draft)).data;
  expect(scheduled.lifecycle).toBe('scheduled'); expect(new Date(scheduled.startAt).toISOString()).toBe(start);
  expect((await resolveExperience('quick', 'mobile', '', Date.parse(start) + 1000)).theme.header.title).toBe('Tomorrow');
});
test('pause, resume and archive keep a pending draft; publishing a paused record publishes its draft', async () => {
  const row = await live();
  const draft = await saveDraft(row, { title: 'After pause' });
  const paused = (await transition(draft, 'pause')).data;
  expect(paused.draft).toMatchObject({ revision: 1, stale: false }); expect((await publicRead()).theme.header).toBeUndefined();
  const pausedEdit = await saveDraft(paused, { title: 'Edited while paused' });
  expect(pausedEdit.status).toBe('paused');
  await transition(pausedEdit); expect((await publicRead()).theme.header.title).toBe('Edited while paused');
  const second = await saveDraft((await send('get', '/api/admin/storefront?kind=theme').expect(200)).body.data[0], { title: 'Kept on archive' });
  const archived = (await transition(second, 'archive')).data;
  expect(archived.draft.revision).toBe(1); expect((await publicRead()).theme.header).toBeUndefined();
});
test('draft saves on a live splash campaign do not change its public revision (no repeat splash)', async () => {
  const row = (await transition(await create(promo()))).data;
  const before = (await request(app).get('/api/storefront/experience?scope=quick&device=mobile').expect(200)).body.data.splash;
  await send('patch', `/api/admin/storefront/${row._id}`, { ...promo({ name: 'Renamed' }), revision: row.revision }).expect(200);
  const after = (await request(app).get('/api/storefront/experience?scope=quick&device=mobile').expect(200)).body.data.splash;
  expect(after.revision).toBe(before.revision); expect(after.name).toBe(before.name);
});
test('never-published drafts and legacy published records keep their existing behavior', async () => {
  const draftOnly = await create(festive());
  const edited = (await send('patch', `/api/admin/storefront/${draftOnly._id}`, { ...festive({ title: 'In place' }), revision: draftOnly.revision }).expect(200)).body.data;
  expect(edited).toMatchObject({ status: 'draft', revision: draftOnly.revision + 1, draft: null }); expect(edited.config.header.title).toBe('In place');
  const legacy = await Experience.collection.insertOne({ kind: 'theme', name: 'Legacy live', status: 'published', scope: 'global', device: 'all', priority: 0, order: 0, revision: 3, timezone: 'Asia/Kolkata', config: { preset: 'Default Bulkimart', tokens: DEFAULT_TOKENS }, history: [] });
  expect((await publicRead()).theme.id).toBe(String(legacy.insertedId));
  const legacyDraft = (await send('patch', `/api/admin/storefront/${legacy.insertedId}`, { ...festive(), revision: 3 }).expect(200)).body.data;
  expect(legacyDraft).toMatchObject({ revision: 3, draft: { revision: 1, stale: false } }); expect((await publicRead()).theme.header).toEqual(DEFAULT_HEADER);
  await transition(legacyDraft); expect((await publicRead()).theme.header.title).toBe('Festive Sale');
});
