import { errorCodes, isErrorWithCode, pick, types } from '@react-native-documents/picker';
import { MediaError, pickPhotos, takePhoto } from './media';

// KYC documents and ticket attachments: JPG, PNG, WEBP or PDF, 5 MB each.
// This is the web rule (SellerContext.handleDocUpload); the backend uploader also allows these types.
export const DOC_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_DOC_BYTES = 5 * 1024 * 1024;

const normalise = (d) => {
  const type = d.type === 'image/jpg' ? 'image/jpeg' : d.type;
  if (!DOC_TYPES.includes(type)) throw new MediaError(`${d.name || 'File'}: only JPG, PNG, WEBP images or PDF files are allowed.`);
  if (d.size && d.size > MAX_DOC_BYTES) throw new MediaError(`${d.name || 'File'} is too large. The maximum size is 5 MB.`);
  return { uri: d.uri, name: d.name || `document-${Date.now()}`, type, size: d.size || null };
};

/** Android system document picker (no storage permission needed). */
export async function pickDocuments({ multiple = false } = {}) {
  try {
    const results = await pick({ type: [types.pdf, types.images], allowMultiSelection: multiple });
    return results.map((r) => normalise({ uri: r.uri, name: r.name, type: r.type, size: r.size }));
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return [];
    if (e instanceof MediaError) throw e;
    throw new MediaError('Could not open the file picker.');
  }
}

/** source: 'camera' | 'gallery' | 'files' */
export async function pickDocument(source, { multiple = false, limit = 1 } = {}) {
  if (source === 'camera') return (await takePhoto()).map(normalise);
  if (source === 'gallery') return (await pickPhotos(limit)).map(normalise);
  return pickDocuments({ multiple });
}
