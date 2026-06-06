const multer = require("multer");

// Store in memory briefly so route handlers can upload images to Firebase Storage.
const storage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(Object.assign(new Error("Only image files are accepted."), { status: 400 }), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  // Keep item photos small for fast storefront/admin rendering.
  limits: { fileSize: 650 * 1024 },
});

module.exports = { upload };
