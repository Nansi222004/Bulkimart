import {
  clearSellerDraft,
  getSellerDraftKey,
  readSellerDraft,
  sellerTypeLabelFromModes,
  selectedModesToChannels,
  writeSellerDraft,
} from '../../../forntend/src/modules/Seller/utils/onboardingDraft.js';

const makeStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
};

test.each([
  [['ecommerce'], ['ecommerce']],
  [['quick'], ['grocery']],
  [['ecommerce', 'quick'], ['ecommerce', 'grocery']],
])('maps selected seller modes %j to canonical channels %j', (modes, expected) => {
  expect(selectedModesToChannels(modes)).toEqual(expected);
});

test.each([
  [['ecommerce'], 'E-Commerce'],
  [['quick'], 'Quick Commerce'],
  [['ecommerce', 'quick'], 'Hybrid'],
  [[], 'Select a sales channel'],
])('shows the selected seller type for %j', (modes, expected) => {
  expect(sellerTypeLabelFromModes(modes)).toBe(expected);
});

test('rejects missing or invalid channel selections instead of silently defaulting', () => {
  expect(() => selectedModesToChannels([])).toThrow(/at least one valid/);
  expect(() => selectedModesToChannels(undefined)).toThrow(/at least one valid/);
  expect(() => selectedModesToChannels(['wholesale'])).toThrow(/at least one valid/);
  expect(() => selectedModesToChannels(['quick', 'legacy'])).toThrow(/at least one valid/);
});

test('draft is account-scoped, restores allowed fields, and excludes sensitive fields', () => {
  const storage = makeStorage();
  const key = getSellerDraftKey('user-123');
  expect(getSellerDraftKey('user-456')).not.toBe(key);
  expect(writeSellerDraft(storage, key, {
    step: 6,
    selectedTypes: ['quick'],
    bizForm: { storeName: 'Market', vendorType: 'General Vendor', category: 'Food', description: 'Local store' },
    otpCode: '123456', aadhaarNo: '123456789012', accountNumber: '1234567890', ifscCode: 'ABCD1234567',
    panNumber: 'ABCDE1234F', addressForm: { street: 'Private address' }, uploadedDocs: { aadhaarFront: { name: 'id.jpg' } },
  }, 1000)).toBe(true);

  const raw = storage.getItem(key);
  expect(raw).not.toMatch(/123456|ABCDE|Private address|id\.jpg|accountNumber|ifscCode|aadhaarNo|otpCode/);
  expect(readSellerDraft(storage, key, 1001)).toMatchObject({
    step: 6,
    selectedTypes: ['quick'],
    bizForm: { storeName: 'Market', category: 'Food', description: 'Local store' },
  });
  expect(readSellerDraft(storage, getSellerDraftKey('user-456'), 1001)).toBeNull();
});

test('malformed and expired drafts are removed and completed drafts can be cleared', () => {
  const storage = makeStorage();
  const key = getSellerDraftKey('user-123');
  storage.setItem(key, '{bad json');
  expect(readSellerDraft(storage, key, 5000)).toBeNull();
  expect(storage.getItem(key)).toBeNull();

  writeSellerDraft(storage, key, { step: 4, selectedTypes: ['ecommerce'], bizForm: {} }, 1000);
  expect(readSellerDraft(storage, key, 1000 + 8 * 24 * 60 * 60 * 1000)).toBeNull();
  expect(storage.getItem(key)).toBeNull();
  clearSellerDraft(storage, key);
  expect(storage.getItem(key)).toBeNull();
});
