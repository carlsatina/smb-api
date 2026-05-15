import multer from "multer";
import dotenv from 'dotenv';
import path from "path";

dotenv.config()

// Filter uploaded file
const storage = multer.diskStorage({
    destination: function(req, file, callback) {
        // Set the destination file for the uploaded logo for each service.
        if (process.env.NODE_ENV === 'development') {
            callback(null, path.join(__dirname, '../../uploaded-images/logo'))
        } else {
            callback(null, path.join(__dirname, '../../../uploaded-images/logo'))
        }
    },
    filename: function(req, file, callback) {
        callback(null, Date.now() + '-' + file.originalname)
    }
})

const fileFilter = (req: any, file: any, cb: any) => {
    if (file.mimetype === 'image/jpeg' ||
        file.mimetype === 'image/jpg' ||
        file.mimetype === 'image/png' ||
        file.mimetype === 'image/webp') {
        cb(null, true)
    } else {
        cb("Not an image! Please upload an image", false)
    }
}
const uploadLogo = multer({
    storage: storage,
    limits: {
        fileSize: 1 * 1024 * 1024, // limit filesize to 1MB
        files: 5
    },
    fileFilter: fileFilter
})

export { uploadLogo }