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
    cb(new Error('Invalid file type. Only JPEG, PNG, WEBP images and PDF documents are allowed.'), false);
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
export const uploadMultiple = (fieldName, maxCount = 5) => upload.array(fieldName, maxCount);
export const uploadFields = (fieldsArray) => upload.fields(fieldsArray);
export const uploadBulkFiles = multer({ storage }).fields([
  { name: 'excelFile', maxCount: 1 },
  { name: 'zipFile', maxCount: 1 }
]);
