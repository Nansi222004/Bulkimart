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
export const uploadBulkFiles = multer({ storage }).fields([
  { name: 'excelFile', maxCount: 1 },
  { name: 'zipFile', maxCount: 1 }
]);
