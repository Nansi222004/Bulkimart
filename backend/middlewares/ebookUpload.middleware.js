import multer from 'multer';
import { getMaxEbookBytes } from '../services/ebookStorage.service.js';

const storage = multer.memoryStorage();

export const uploadEbookFile = (fieldName = 'file') => multer({
  storage,
  limits: { fileSize: getMaxEbookBytes(), files: 1 },
  fileFilter: (_req, file, callback) => {
    const isPdf = file.mimetype === 'application/pdf'
      && String(file.originalname || '').toLowerCase().endsWith('.pdf');
    if (!isPdf) return callback(Object.assign(new Error('Only PDF e-books are supported'), { status: 400 }));
    callback(null, true);
  },
}).single(fieldName);
