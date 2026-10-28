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

const limits = {
  fileSize: 5 * 1024 * 1024 // 5 MB limit
};

const upload = multer({
  storage,
  fileFilter,
  limits
});

export const uploadSingle = (fieldName) => upload.single(fieldName);
export const uploadBannerImage = multer({ storage, limits, fileFilter: (_req, file, cb) => {
  const allowed = { 'image/jpeg': /\.jpe?g$/i, 'image/png': /\.png$/i, 'image/webp': /\.webp$/i };
  cb(allowed[file.mimetype]?.test(file.originalname) ? null : Object.assign(new Error('Banner artwork must be JPEG, PNG or WebP'), { status: 400 }), true);
} }).single('image');
export const uploadMultiple = (fieldName, maxCount = 5) => upload.array(fieldName, maxCount);
export const uploadFields = (fieldsArray) => upload.fields(fieldsArray);
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
export const uploadProductImages = (fieldName, maxCount = 5) => productImageUpload.array(fieldName, maxCount);

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
  next(error);
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
