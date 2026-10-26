import {
  assertNoDuplicateCloudinaryEnvDefinitions,
  getCloudinaryConfig,
  inspectCloudinaryEnvText,
} from '../../config/cloudinary.js';

test('detects duplicate and conflicting keys without returning their values', () => {
  const source = [
    'CLOUDINARY_CLOUD_NAME=cloud-one',
    'CLOUDINARY_API_KEY=key-one',
    'CLOUDINARY_API_SECRET=private-first',
    'CLOUDINARY_API_SECRET=private-second',
  ].join('\n');

  const result = inspectCloudinaryEnvText(source);
  expect(result.duplicateKeys).toEqual(['CLOUDINARY_API_SECRET']);
  expect(result.conflictingKeys).toEqual(['CLOUDINARY_API_SECRET']);
  expect(result).not.toHaveProperty('definitions');

  expect(() => assertNoDuplicateCloudinaryEnvDefinitions({ source })).toThrow(
    expect.objectContaining({ code: 'UPLOAD_CONFIGURATION_CONFLICT' }),
  );
  try {
    assertNoDuplicateCloudinaryEnvDefinitions({ source });
  } catch (error) {
    expect(error.message).not.toMatch(/private-first|private-second/);
  }
});

test('also rejects redundant duplicate definitions to keep one source of truth', () => {
  expect(() => assertNoDuplicateCloudinaryEnvDefinitions({
    source: 'CLOUDINARY_API_KEY=same\nCLOUDINARY_API_KEY=same',
  })).toThrow(expect.objectContaining({ code: 'UPLOAD_CONFIGURATION_DUPLICATE' }));
});

test('trims individual variables into one coherent SDK configuration', () => {
  expect(getCloudinaryConfig({
    CLOUDINARY_CLOUD_NAME: ' cloud ',
    CLOUDINARY_API_KEY: ' key ',
    CLOUDINARY_API_SECRET: ' secret ',
  })).toEqual({ cloud_name: 'cloud', api_key: 'key', api_secret: 'secret' });
});

test('decodes a URL configuration without exposing it to browser code', () => {
  expect(getCloudinaryConfig({
    CLOUDINARY_URL: 'cloudinary://key%2Fpart:secret%40part@cloud-name',
  })).toEqual({ cloud_name: 'cloud-name', api_key: 'key/part', api_secret: 'secret@part' });
});

test('rejects simultaneous URL and individual credential sources', () => {
  expect(() => getCloudinaryConfig({
    CLOUDINARY_URL: 'cloudinary://key:secret@cloud',
    CLOUDINARY_CLOUD_NAME: 'cloud',
  })).toThrow(expect.objectContaining({ code: 'UPLOAD_CONFIGURATION_DUPLICATE_SOURCE' }));
});
