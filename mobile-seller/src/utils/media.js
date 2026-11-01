import { PermissionsAndroid, Platform } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';

// Same rules as the web product form (ProductModal.jsx) and the backend uploader:
// JPG, PNG or WEBP, at most 5 MB each.
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const PICK_OPTIONS = { mediaType: 'photo', includeBase64: false, quality: 0.85, maxWidth: 2000, maxHeight: 2000 };

export class MediaError extends Error {}

function toImage(asset) {
  if (!asset?.uri) return null;
  const type = asset.type === 'image/jpg' ? 'image/jpeg' : asset.type;
  if (!ALLOWED_IMAGE_TYPES.includes(type)) throw new MediaError(`${asset.fileName || 'Photo'}: only JPG, PNG or WEBP allowed.`);
  if (asset.fileSize && asset.fileSize > MAX_IMAGE_BYTES) throw new MediaError(`${asset.fileName || 'Photo'} is larger than 5 MB.`);
  const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return { uri: asset.uri, type, name: asset.fileName || `photo-${Date.now()}.${extension}`, size: asset.fileSize || null };
}

function handleResult(result) {
  if (result.didCancel) return [];
  if (result.errorCode) {
    if (result.errorCode === 'camera_unavailable') throw new MediaError('No camera is available on this device.');
    if (result.errorCode === 'permission') throw new MediaError('Camera permission is needed to take product photos. You can allow it in Android Settings, or choose from the gallery instead.');
    throw new MediaError(result.errorMessage || 'Could not open the photo picker.');
  }
  return (result.assets || []).map(toImage).filter(Boolean);
}

// Asked only when the seller taps "Camera", never at app start.
async function ensureCameraPermission() {
  if (Platform.OS !== 'android') return true;
  const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
    title: 'Camera access',
    message: 'Bulkimart Seller uses the camera to take photos of your products.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  if (status === PermissionsAndroid.RESULTS.GRANTED) return true;
  throw new MediaError(status === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
    ? 'Camera permission is turned off for Bulkimart Seller. Allow it in Android Settings, or choose photos from the gallery.'
    : 'Camera permission was not given. You can still choose photos from the gallery.');
}

export async function takePhoto() {
  await ensureCameraPermission();
  return handleResult(await launchCamera({ ...PICK_OPTIONS, saveToPhotos: false, cameraType: 'back' }));
}

// The Android system photo picker needs no storage permission.
export async function pickPhotos(limit = 1) {
  return handleResult(await launchImageLibrary({ ...PICK_OPTIONS, selectionLimit: Math.max(1, limit) }));
}
