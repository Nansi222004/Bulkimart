import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, realpath, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_STORAGE_DIR = fileURLToPath(new URL('../private-data/ebooks/', import.meta.url));
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ebookStorageDirectory = () => path.resolve(process.env.EBOOK_STORAGE_DIR || DEFAULT_STORAGE_DIR);

const isInside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const publicStorageRoots = () => {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  return [
    path.join(projectRoot, 'forntend', 'public'),
    path.join(projectRoot, 'forntend', 'dist'),
    path.join(projectRoot, 'frontend', 'public'),
    path.join(projectRoot, 'frontend', 'dist'),
  ].map((entry) => path.resolve(entry));
};

const assertNotPublicStorage = async (root) => {
  const publicRoots = publicStorageRoots();
  if (publicRoots.some((publicRoot) => isInside(publicRoot, path.resolve(root)))) {
    throw Object.assign(new Error('E-book storage must be outside frontend public and build directories'), { status: 500 });
  }
  const actualRoot = await realpath(root);
  if (publicRoots.some((publicRoot) => isInside(publicRoot, actualRoot))) {
    throw Object.assign(new Error('E-book storage must be outside frontend public and build directories'), { status: 500 });
  }
};

export const validateEbookPdf = (file, maxBytes = getMaxEbookBytes()) => {
  const invalid = (message) => Object.assign(new Error(message), { status: 400 });
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) throw invalid('A PDF file is required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('E-book upload limit is invalid');
  if (file.size > maxBytes || file.buffer.length > maxBytes) throw invalid('E-book file exceeds the upload limit');
  if (path.extname(file.originalname || '').toLowerCase() !== '.pdf') throw invalid('Only PDF e-books are supported');
  if (file.mimetype !== 'application/pdf') throw invalid('The uploaded file must be declared as a PDF');
  // PDF header must be near the start; permit a small prefix for valid files.
  if (!file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw invalid('The uploaded file is not a valid PDF');
  return { sizeBytes: file.buffer.length, format: 'pdf', sha256: createHash('sha256').update(file.buffer).digest('hex') };
};

export const getMaxEbookBytes = () => {
  const configured = process.env.EBOOK_MAX_UPLOAD_BYTES;
  if (configured === undefined || configured === '') return 25 * 1024 * 1024;
  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 250 * 1024 * 1024) {
    throw new Error('E-book upload limit configuration is invalid');
  }
  return parsed;
};

const resolveFilePath = (fileId) => {
  if (!ID_PATTERN.test(String(fileId || ''))) throw new Error('Invalid private file identifier');
  const root = ebookStorageDirectory();
  const target = path.resolve(root, `${fileId}.pdf`);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid private file path');
  return target;
};

export const storeEbookPdf = async (file) => {
  const metadata = validateEbookPdf(file);
  const fileId = randomUUID();
  const root = ebookStorageDirectory();
  const target = resolveFilePath(fileId);
  try {
    if (publicStorageRoots().some((publicRoot) => isInside(publicRoot, root))) {
      throw Object.assign(new Error('E-book storage must be outside frontend public and build directories'), { status: 500 });
    }
    await mkdir(root, { recursive: true, mode: 0o700 });
    await assertNotPublicStorage(root);
    await chmod(root, 0o700);
    // wx avoids overwriting even in the extraordinarily unlikely identifier collision.
    await writeFile(target, file.buffer, { flag: 'wx', mode: 0o600 });
  } catch {
    await unlink(target).catch(() => {});
    throw Object.assign(new Error('Private e-book storage is unavailable. Check local storage configuration and permissions.'), { status: 503 });
  }
  return { fileId, ...metadata, uploadedAt: new Date() };
};

export const removeStoredEbook = async (fileId) => {
  const target = resolveFilePath(fileId);
  try { await unlink(target); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
};

export const ebookStorageConfiguration = Object.freeze({
  defaultDirectory: DEFAULT_STORAGE_DIR,
  maxUploadBytes: getMaxEbookBytes,
});
