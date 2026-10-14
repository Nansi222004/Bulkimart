import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, rename, unlink, realpath, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './serviceForms.service.js';
import { validateEbookPdf } from './ebookStorage.service.js';
import { SERVICE_FILE_BYTES } from '../../shared/serviceLimits.mjs';
export const MAX_SERVICE_FILE = SERVICE_FILE_BYTES;
const project = fileURLToPath(new URL('../../', import.meta.url));
const inside = (root, target) => { const relative = path.relative(root, target); return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative)); };
export async function storageRoot() {
  const configured = process.env.SERVICE_STORAGE_DIR;
  if (!configured && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_ENV === 'production')) fail('Private service storage is not configured', 503);
  const root = path.resolve(configured || path.join(project, 'backend/private-data/services'));
  const assertPrivate = p => {
    if (['forntend/public', 'forntend/dist', 'frontend/public', 'frontend/dist'].some(d => inside(path.join(project, d), p))) fail('Service storage must be outside public directories', 503);
  };
  assertPrivate(root);
  try { await mkdir(root, { recursive: true, mode: 0o700 }); const actual = await realpath(root); assertPrivate(actual); return actual; }
  catch { fail('Private service storage is unavailable', 503); }
}
export function validateServiceFile(file) {
  const b = file.buffer;
  if (!Buffer.isBuffer(b) || !b.length || b.length > MAX_SERVICE_FILE) fail('File must be between 1 byte and 5 MB');
  const ext = path.extname(file.originalname || '').toLowerCase();
  let format;
  if (ext === '.pdf' && file.mimetype === 'application/pdf') { validateEbookPdf(file, MAX_SERVICE_FILE); format = 'pdf'; }
  if (ext === '.png' && file.mimetype === 'image/png' && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && b.length >= 24) format = 'png';
  if (['.jpg', '.jpeg'].includes(ext) && file.mimetype === 'image/jpeg' && b[0] === 255 && b[1] === 216 && b[2] === 255 && b[b.length - 2] === 255 && b[b.length - 1] === 217) format = 'jpg';
  if (!format) fail('Only valid PDF, PNG and JPEG documents are allowed');
  return { fieldname: file.fieldname, name: path.basename(file.originalname.replaceAll('\\', '/')).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 150) || `document.${format}`, format, sizeBytes: b.length, sha256: createHash('sha256').update(b).digest('hex') };
}
export async function storeServiceFiles(files, kind) {
  const metadata = files.map(validateServiceFile);
  const root = await storageRoot();
  const stored = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const fileId = randomUUID();
      const ref = { ...metadata[i], fileId, kind, uploadedAt: new Date() };
      stored.push(ref);
      await writeFile(path.join(root, `${fileId}.partial`), files[i].buffer, { flag: 'wx', mode: 0o600 });
      await rename(path.join(root, `${fileId}.partial`), path.join(root, fileId));
    }
    return stored;
  } catch {
    await removeServiceFiles(stored);
    fail('Private service storage is unavailable', 503);
  }
}
const validId = id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export async function removeServiceFiles(files) {
  const root = await storageRoot();
  for (const file of files) if (validId(file.fileId)) {
    await unlink(path.join(root, file.fileId)).catch(() => {});
    await unlink(path.join(root, `${file.fileId}.partial`)).catch(() => {});
  }
}
export async function readServiceFile(file) {
  if (!validId(file.fileId)) fail('Document unavailable', 404);
  try {
    const root = await storageRoot();
    const target = path.join(root, file.fileId);
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.sizeBytes) throw new Error();
    const buffer = await readFile(target);
    if (createHash('sha256').update(buffer).digest('hex') !== file.sha256) throw new Error();
    return buffer;
  } catch { fail('Document temporarily unavailable', 503); }
}
