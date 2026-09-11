const multer = require("multer");
const path = require("path");
const fs = require("fs");

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const uploadsRoot = path.join(__dirname, "../uploads");

const imageFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Not an image! Please upload an image."), false);
  }
};

// Ticket/chat attachments can be photos, screenshots, PDFs, or docs.
const attachmentFileFilter = (req, file, cb) => {
  const allowed = /^(image\/|application\/pdf$|application\/msword$|application\/vnd\.openxmlformats-officedocument|application\/vnd\.ms-excel$|text\/plain$)/;
  if (allowed.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Unsupported file type."), false);
  }
};

const makeDiskStorage = (subfolder, prefix) => {
  const dir = path.join(uploadsRoot, subfolder);
  ensureDir(dir);
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, `${prefix}-${uniqueSuffix}${path.extname(file.originalname)}`);
    },
  });
};

// ── Company logo / favicon (legacy single-folder uploader) ──────────────
const upload = multer({
  storage: makeDiskStorage("logos", "logo"),
  limits: { fileSize: 1024 * 1024 * 2 }, // 2MB
  fileFilter: imageFileFilter,
});

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 2 }, // 2MB
  fileFilter: imageFileFilter,
});

// ── Company assets (logo + favicon together) ────────────────────────────
const uploadCompanyAssets = multer({
  storage: makeDiskStorage("company", "company"),
  limits: { fileSize: 1024 * 1024 * 2 }, // 2MB
  fileFilter: imageFileFilter,
});

// ── User / Operator profile pictures ─────────────────────────────────────
const uploadProfilePic = multer({
  storage: makeDiskStorage("profile", "profile"),
  limits: { fileSize: 1024 * 1024 * 2 }, // 2MB
  fileFilter: imageFileFilter,
});

// ── Support ticket / chat attachments ────────────────────────────────────
const uploadTicketAttachments = multer({
  storage: makeDiskStorage("tickets", "ticket"),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 }, // 5MB per file, 5 files per message
  fileFilter: attachmentFileFilter,
});

module.exports = {
  upload,
  uploadMemory,
  uploadCompanyAssets,
  uploadProfilePic,
  uploadTicketAttachments,
};
