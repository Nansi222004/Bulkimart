import multer from 'multer';

// Memory storage to preserve file as Buffer for direct streaming to Cloudinary
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/svg+xml',
    'application/pdf'
  ];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(Object.assign(
      new Error('Invalid file type. Only JPEG, PNG, WEBP images and PDF documents are allowed.'),
      { status: 400 },
    ), false);
  }
};

/**
 * Content check after multer (audit I7): the declared MIME type comes from the client, so the bytes must match it.
 * Raster images and PDFs are checked by their file signature; SVG (served from Cloudinary as an image) must be
 * plain markup with no script, event handlers, javascript: URLs or embedded HTML.
 */
const SIGNATURES = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  'application/pdf': (b) => b.length > 5 && b.toString('latin1', 0, 5) === '%PDF-',
  'image/svg+xml': (b) => {
    const text = b.toString('utf8');
    return /<svg[\s>]/i.test(text) && !/<script|<foreignObject|\son\w+\s*=|javascript:|<iframe|<embed|<object/i.test(text);
  },
};
export const fileContentMatches = (file) => {
  const check = SIGNATURES[file?.mimetype];
  return Boolean(check && Buffer.isBuffer(file.buffer) && check(file.buffer));
};
const uploadedFiles = (req) => [req.file, ...(Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat())].filter(Boolean);
/** Wraps a multer middleware so every stored file's bytes must match its declared type. */
export const withContentCheck = (middleware) => (req, res, next) => middleware(req, res, (error) => {
  if (error) return next(error);
  const bad = uploadedFiles(req).find((file) => !fileContentMatches(file));
  if (bad) return next(Object.assign(new Error(`The file "${String(bad.originalname || 'upload').slice(0, 80)}" is not a valid ${bad.mimetype} file.`), { status: 400 }));
  next();
});

const limits = {
  fileSize: 5 * 1024 * 1024 // 5 MB limit
};

const upload = multer({
  storage,
  fileFilter,
  limits
});

export const uploadSingle = (fieldName) => withContentCheck(upload.single(fieldName));
export const uploadBannerImage = withContentCheck(multer({ storage, limits, fileFilter: (_req, file, cb) => {
  const allowed = { 'image/jpeg': /\.jpe?g$/i, 'image/png': /\.png$/i, 'image/webp': /\.webp$/i };
  cb(allowed[file.mimetype]?.test(file.originalname) ? null : Object.assign(new Error('Banner artwork must be JPEG, PNG or WebP'), { status: 400 }), true);
} }).single('image'));
export const uploadMultiple = (fieldName, maxCount = 5) => withContentCheck(upload.array(fieldName, maxCount));
export const uploadFields = (fieldsArray) => withContentCheck(upload.fields(fieldsArray));
// Product visual assets must never accept PDF files; actual e-book bytes use
// the separate private-storage route, never this Cloudinary image pipeline.
export const isProductImageMime = (mimeType) => ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(mimeType);

const productImageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!isProductImageMime(file.mimetype)) {
      return cb(Object.assign(new Error('Product photos must be JPEG, PNG, WEBP, or SVG images'), { status: 400 }));
    }
    cb(null, true);
  },
});
export const uploadProductImages = (fieldName, maxCount = 5) => withContentCheck(productImageUpload.array(fieldName, maxCount));

// Review photos travel as files rather than base64 inside the small JSON body.
const reviewImageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 4, fields: 2, fieldSize: 100 * 1024 },
  fileFilter: (_req, file, cb) => cb(['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
    ? null : Object.assign(new Error('Review photos must be JPG, PNG or WEBP images.'), { status: 400 }), true),
}).array('images', 4);
export const uploadReviewImages = (req, res, next) => reviewImageUpload(req, res, error => {
  if (error?.code === 'LIMIT_FILE_SIZE') return next(Object.assign(new Error('Each review photo must be 5 MB or smaller.'), { status: 413 }));
  if (['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(error?.code)) return next(Object.assign(new Error('You can upload up to 4 review photos.'), { status: 400 }));
  if (error) return next(error);
  const bad = uploadedFiles(req).find((file) => !fileContentMatches(file));
  next(bad ? Object.assign(new Error('Review photos must be real JPG, PNG or WEBP images.'), { status: 400 }) : undefined);
});
const bulkFiles = multer({ storage, limits: { fileSize: 50 * 1024 * 1024, files: 2 }, fileFilter: (_req, file, cb) => {
  const valid = file.fieldname === 'excelFile' ? /\.(xlsx|csv)$/i.test(file.originalname) : file.fieldname === 'zipFile' && /\.zip$/i.test(file.originalname);
  cb(valid ? null : Object.assign(new Error(file.fieldname === 'excelFile' ? 'Product sheet must be an .xlsx or .csv file.' : 'Product images must be a .zip archive.'), { status: 400 }), valid);
} }).fields([
  { name: 'excelFile', maxCount: 1 },
  { name: 'zipFile', maxCount: 1 }
]);
export const uploadBulkFiles = (req, res, next) => bulkFiles(req, res, error => {
  if (error?.code === 'LIMIT_FILE_SIZE') return next(Object.assign(new Error('Image ZIP must be 50 MB or smaller; product sheet must be 10 MB or smaller.'), { status: 413 }));
  if (!error && req.files?.excelFile?.[0]?.size > 10 * 1024 * 1024) return next(Object.assign(new Error('Product sheet must be 10 MB or smaller.'), { status: 413 }));
  next(error);
});
