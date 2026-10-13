import { jest } from '@jest/globals';

let uploadError = null;
let uploadResult = { secure_url: 'https://cdn.example.test/document.jpg', public_id: 'doc-1', resource_type: 'image', bytes: 123, format: 'jpg' };
const uploadStream = jest.fn((options, callback) => ({
  end: jest.fn(() => callback(uploadError, uploadResult)),
}));
const config = jest.fn();
const ping = jest.fn();

process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

jest.unstable_mockModule('cloudinary', () => ({
  v2: { config, api: { ping }, uploader: { upload_stream: uploadStream, destroy: jest.fn() } },
}));

const {
  assertCloudinaryConfigured,
  safeCloudinaryUploadError,
  uploadToCloudinary,
  verifyCloudinary,
} = await import('../../services/cloudinary.service.js');

beforeEach(() => {
  jest.clearAllMocks();
  uploadError = null;
  ping.mockResolvedValue({ status: 'ok' });
  uploadResult = { secure_url: 'https://cdn.example.test/document.jpg', public_id: 'doc-1', resource_type: 'image', bytes: 123, format: 'jpg' };
});

test('streams a valid document server-side and returns only its secure URL', async () => {
  await expect(uploadToCloudinary(Buffer.from('image'), 'delivery-kyc/user-1')).resolves.toBe(uploadResult.secure_url);
  expect(uploadStream).toHaveBeenCalledWith(
    expect.objectContaining({ folder: 'nhcone/delivery-kyc/user-1', resource_type: 'auto' }),
    expect.any(Function),
  );
});

test('invalid-signature details are never exposed to the client', async () => {
  uploadError = { http_code: 401, message: 'Invalid Signature abc123. String to sign - timestamp=12345.' };
  await expect(uploadToCloudinary(Buffer.from('image'), 'delivery-kyc/user-1')).rejects.toMatchObject({
    status: 503,
    code: 'UPLOAD_CONFIGURATION_REJECTED',
    message: expect.not.stringMatching(/abc123|timestamp=12345|Invalid Signature/i),
  });
});

test('missing upload configuration fails safely at the integration boundary', () => {
  expect(() => assertCloudinaryConfigured({ cloud_name: '', api_key: '', api_secret: '' })).toThrow(
    'server upload configuration is incomplete',
  );
});

test('ordinary provider failure is retryable without leaking provider internals', () => {
  const error = safeCloudinaryUploadError(new Error('socket closed at private upstream host'));
  expect(error).toMatchObject({ status: 502, code: 'UPLOAD_PROVIDER_ERROR' });
  expect(error.message).toBe('Document upload failed. Please try again.');
});

test('credential verification sanitizes provider authentication details', async () => {
  ping.mockRejectedValue({
    http_code: 401,
    message: 'Invalid Signature private-signature. String to sign - timestamp=12345.',
  });

  await expect(verifyCloudinary()).resolves.toMatchObject({
    ok: false,
    code: 'UPLOAD_CONFIGURATION_REJECTED',
    message: expect.not.stringMatching(/private-signature|timestamp=12345|Invalid Signature/i),
  });
});
