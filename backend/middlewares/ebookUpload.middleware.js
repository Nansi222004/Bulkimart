import multer from 'multer';
import { getMaxEbookBytes, PDF_UPLOAD_TYPES } from '../services/ebookStorage.service.js';

const storage = multer.memoryStorage();

export const uploadEbookFile = (fieldName = 'file') => multer({
  storage,
  limits: { fileSize: getMaxEbookBytes(), files: 1 },
  fileFilter: (_req, file, callback) => {
    // Phones often label a picked PDF as a generic binary; the file's own bytes
    // are verified as a PDF afterwards (validateEbookPdf).
    const isPdf = PDF_UPLOAD_TYPES.includes(file.mimetype || '')
      && String(file.originalname || '').toLowerCase().endsWith('.pdf');
    if (!isPdf) return callback(Object.assign(new Error('Only PDF e-books are supported'), { status: 400 }));
    callback(null, true);
  },
}).single(fieldName);
