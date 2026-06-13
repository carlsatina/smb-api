import multer from 'multer';
import { AppError } from '../shared/errors';

/**
 * Shared multer instance for CSV file uploads (in-memory, 5 MB cap).
 * Rejects non-CSV files with an AppError so the global error handler returns
 * a clean 400 instead of a generic 500.
 */
export const csvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new AppError('INVALID_FILE_TYPE', 'Only CSV files are allowed', 400));
        }
    },
});

/** Middleware for a single CSV file under the `file` field. */
export const csvUploadSingle = csvUpload.single('file');
