import { jest } from '@jest/globals';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';

process.env.JWT_SECRET = 'test-checkout-address-contact-secret';

const readFrontend = (relativePath) => fs.readFileSync(
  path.resolve(process.cwd(), '../forntend/src/modules/User', relativePath),
  'utf8',
);

describe('Checkout address form UI static verification', () => {
  const checkoutCode = readFrontend('pages/CheckoutPage.jsx');
  const userCss = readFrontend('User.css');

  test('checkout address form does not ask registered customers for Full Name or Mobile Number inputs', () => {
    // Inputs must not exist
    expect(checkoutCode).not.toMatch(/id=["']checkout-name["']/);
    expect(checkoutCode).not.toMatch(/id=["']checkout-phone["']/);
    expect(checkoutCode).not.toMatch(/htmlFor=["']checkout-name["']/);
    expect(checkoutCode).not.toMatch(/htmlFor=["']checkout-phone["']/);
    expect(checkoutCode).not.toMatch(/setAddrName/);
    expect(checkoutCode).not.toMatch(/setAddrPhone/);
  });

  test('checkout address form keeps all required fields and buttons intact', () => {
    // 1. Use Current Location
    expect(checkoutCode).toMatch(/handleUseCurrentLocation/);
    expect(checkoutCode).toMatch(/Use Current Location/);

    // 2. Flat / House / Block Number
    expect(checkoutCode).toMatch(/id=["']checkout-house["']/);
    expect(checkoutCode).toMatch(/Flat \/ House \/ Block No\./);

    // 3. Street / Area / Sector
    expect(checkoutCode).toMatch(/id=["']checkout-street["']/);
    expect(checkoutCode).toMatch(/Street \/ Area \/ Sector/);

    // 4. City & Pincode
    expect(checkoutCode).toMatch(/id=["']checkout-city["']/);
    expect(checkoutCode).toMatch(/id=["']checkout-pincode["']/);

    // 5. Address Type: Home / Work
    expect(checkoutCode).toMatch(/checkout-address-type/);
    expect(checkoutCode).toMatch(/\['Home',\s*'Work'\]/);

    // 6. Optional Landmark Photo
    expect(checkoutCode).toMatch(/LandmarkImagePicker/);
    expect(checkoutCode).toMatch(/Landmark Photo \(Optional\)/);

    // 7. Save & Select Address
    expect(checkoutCode).toMatch(/Save & Select Address/);
  });

  test('missing profile details produce a clear validation message and action to complete profile', () => {
    expect(checkoutCode).toMatch(/checkout-profile-warning/);
    expect(checkoutCode).toMatch(/Complete your profile/);
    expect(checkoutCode).toMatch(/setActiveNav\('account'\)/);
    expect(checkoutCode).toMatch(/Complete Profile/);
    expect(checkoutCode).toMatch(/addressFormError/);
  });

  test('User.css includes styling for recipient indicator, warning alert, and error message', () => {
    expect(userCss).toMatch(/\.checkout-recipient-info/);
    expect(userCss).toMatch(/\.checkout-profile-warning/);
    expect(userCss).toMatch(/\.checkout-complete-profile-btn/);
    expect(userCss).toMatch(/\.checkout-form-error/);
  });
});

describe('Address and Checkout contact autofill HTTP API tests', () => {
  let currentUserMock = null;

  const mockUserFindById = jest.fn((id, projection) => {
    if (!currentUserMock) return Promise.resolve(null);
    if (projection === 'addresses') {
      return Promise.resolve({ addresses: currentUserMock.addresses });
    }
    return Promise.resolve(currentUserMock);
  });

  jest.unstable_mockModule('../../models/User.js', () => ({
    default: {
      findById: mockUserFindById,
    },
  }));

  let addAddressHandler;
  let updateAddressHandler;
  let getAddressesHandler;
  let errorHandlerMiddleware;

  let app;

  beforeAll(async () => {
    const [userController, errorMiddleware] = await Promise.all([
      import('../../controllers/user.controller.js'),
      import('../../middlewares/error.middleware.js'),
    ]);
    addAddressHandler = userController.addAddress;
    updateAddressHandler = userController.updateAddress;
    getAddressesHandler = userController.getAddresses;
    errorHandlerMiddleware = errorMiddleware.errorHandler;

    app = express();
    app.use(express.json());

    // Fake authentication middleware injecting req.user
    app.use((req, res, next) => {
      req.user = currentUserMock ? { _id: currentUserMock._id } : null;
      next();
    });

    app.post('/api/users/addresses', addAddressHandler);
    app.get('/api/users/addresses', getAddressesHandler);
    app.put('/api/users/addresses/:addressId', updateAddressHandler);
    app.use(errorHandlerMiddleware);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createMockUser = (overrides = {}) => {
    const addresses = [];
    const user = {
      _id: '507f1f77bcf86cd799439011',
      name: 'Aman Verma',
      phone: '9876543210',
      addresses,
      async save() {
        return this;
      },
      ...overrides,
    };
    user.addresses.id = (addrId) => user.addresses.find((a) => String(a._id) === String(addrId));
    return user;
  };

  test('saved address uses the authenticated customer profile name and phone number', async () => {
    currentUserMock = createMockUser({ name: 'Aman Verma', phone: '9876543210' });

    const res = await request(app)
      .post('/api/users/addresses')
      .send({
        line1: 'Flat 101, Galaxy Heights',
        line2: 'Sector 4',
        city: 'Indore',
        state: 'Madhya Pradesh',
        pincode: '452001',
        label: 'Home',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.addresses).toHaveLength(1);
    const saved = res.body.addresses[0];
    expect(saved.name).toBe('Aman Verma');
    expect(saved.phone).toBe('9876543210');
    expect(saved.line1).toBe('Flat 101, Galaxy Heights');
    expect(saved.city).toBe('Indore');
    expect(saved.pincode).toBe('452001');
  });

  test('backend does not blindly trust spoofed contact details sent in request body', async () => {
    currentUserMock = createMockUser({ name: 'Aman Verma', phone: '9876543210' });

    const res = await request(app)
      .post('/api/users/addresses')
      .send({
        name: 'Spoofed Imposter',
        phone: '1111111111',
        line1: 'Office 202',
        city: 'Indore',
        pincode: '452001',
        label: 'Work',
      });

    expect(res.status).toBe(201);
    const saved = res.body.addresses[0];
    // Must enforce authenticated identity, ignoring spoofed values
    expect(saved.name).toBe('Aman Verma');
    expect(saved.phone).toBe('9876543210');
  });

  test('adding the same normalized destination selects the existing address instead of appending it', async () => {
    const existing = {
      _id: '507f1f77bcf86cd799439088',
      name: 'Aman Verma', phone: '9876543210',
      line1: 'Flat 101, Galaxy Heights', line2: 'Sector 4',
      city: 'Indore', state: 'Madhya Pradesh', pincode: '452001',
      label: 'Home', isDefault: true,
    };
    currentUserMock = createMockUser({ addresses: [existing] });
    currentUserMock.save = jest.fn(currentUserMock.save);

    const res = await request(app).post('/api/users/addresses').send({
      line1: '  FLAT 101,  Galaxy Heights ', line2: 'sector 4',
      city: 'INDORE', state: 'madhya pradesh', pincode: '452001', label: 'Work',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ addressId: existing._id, duplicate: true });
    expect(currentUserMock.addresses).toHaveLength(1);
    expect(currentUserMock.save).not.toHaveBeenCalled();
  });

  test('missing profile name or phone produces a clear 400 validation error', async () => {
    currentUserMock = createMockUser({ name: '', phone: '9876543210' });

    const res1 = await request(app)
      .post('/api/users/addresses')
      .send({
        line1: 'Flat 101',
        city: 'Indore',
        pincode: '452001',
      });

    expect(res1.status).toBe(400);
    expect(res1.body.message).toMatch(/complete your profile name/i);

    currentUserMock = createMockUser({ name: 'Aman Verma', phone: '' });

    const res2 = await request(app)
      .post('/api/users/addresses')
      .send({
        line1: 'Flat 101',
        city: 'Indore',
        pincode: '452001',
      });

    expect(res2.status).toBe(400);
    expect(res2.body.message).toMatch(/complete your profile mobile number/i);
  });

  test('address editing preserves existing contact details and does not overwrite with empty values', async () => {
    const existingAddress = {
      _id: '507f1f77bcf86cd799439099',
      name: 'Aman Verma',
      phone: '9876543210',
      line1: 'Old Address 1',
      city: 'Indore',
      pincode: '452001',
      label: 'Home',
    };

    currentUserMock = createMockUser({
      name: 'Aman Verma',
      phone: '9876543210',
      addresses: [existingAddress],
    });

    const res = await request(app)
      .put('/api/users/addresses/507f1f77bcf86cd799439099')
      .send({
        line1: 'New Address 42',
        name: '', // Empty name passed
        phone: '   ', // Whitespace phone passed
      });

    expect(res.status).toBe(200);
    expect(existingAddress.line1).toBe('New Address 42');
    expect(existingAddress.name).toBe('Aman Verma');
    expect(existingAddress.phone).toBe('9876543210');
  });

  test('saved addresses remain selectable and retain contact details', async () => {
    const addr1 = {
      _id: '507f1f77bcf86cd799439001',
      name: 'Aman Verma',
      phone: '9876543210',
      line1: 'House 1',
      city: 'Indore',
      pincode: '452001',
      isDefault: true,
    };
    const addr2 = {
      _id: '507f1f77bcf86cd799439002',
      name: 'Aman Verma',
      phone: '9876543210',
      line1: 'Office 2',
      city: 'Indore',
      pincode: '452001',
      isDefault: false,
    };

    currentUserMock = createMockUser({
      addresses: [addr1, addr2],
    });

    const res = await request(app).get('/api/users/addresses');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]._id).toBe(addr1._id);
    expect(res.body.data[0].phone).toBe('9876543210');
    expect(res.body.data[1]._id).toBe(addr2._id);
  });

  test('address listing hides historical duplicate destinations without deleting records', async () => {
    const first = { _id: '507f1f77bcf86cd799439001', line1: '8 Simrol Colony', city: 'Indore', state: 'Madhya Pradesh', pincode: '452015', isDefault: true };
    const duplicate = { ...first, _id: '507f1f77bcf86cd799439002', line1: ' 8  SIMROL colony ', isDefault: false };
    currentUserMock = createMockUser({ addresses: [first, duplicate] });

    const res = await request(app).get('/api/users/addresses');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]._id).toBe(first._id);
    expect(currentUserMock.addresses).toHaveLength(2);
  });
});
